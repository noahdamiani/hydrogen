import {gql} from '@shopify/hydrogen';
import type {HydrogenApiRouteOptions, HydrogenRequest} from '@shopify/hydrogen';

import {Customer} from '@shopify/hydrogen/storefront-api-types';
import {Multipassify} from './multipassify';

declare global {
  // eslint-disable-next-line no-var
  var Oxygen: {env: any; [key: string]: any};
}

export interface CustomerInfo {
  email: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  phone?: string;
  return_to?: string;
}

interface CustomerDataType {
  customer?: CustomerInfo;
}

// POST `/multipass-checkout` endpoint.
// expected body: { checkoutUrl: string }
export async function api(
  request: HydrogenRequest,
  {session, queryShop}: HydrogenApiRouteOptions,
) {
  try {
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({
          data: null,
          error: 'Method not allowed.',
        }),
        {
          status: 405,
          headers: {'Content-Type': 'application/json', Allow: 'POST'},
        },
      );
    }

    const {checkoutUrl} = await request.json();

    if (!checkoutUrl) {
      return NotLoggedInResponse({
        url: null,
        error: 'MISSING_CHECKOUT_URL',
      });
    }

    if (!session) {
      return NotLoggedInResponse({
        url: checkoutUrl,
        error: 'MISSING_SESSION',
      });
    }

    const {customerAccessToken} = await session.get();

    if (!customerAccessToken) {
      return NotLoggedInResponse({
        url: checkoutUrl,
        error: 'MISSING_CUSTOMER_ACCESS_TOKEN',
      });
    }

    const {data, errors} = await queryShop({
      query: CUSTOMER_INFO_QUERY,
      variables: {customerAccessToken},
    });

    if (errors) {
      // eslint-disable-next-line no-console
      console.error(
        'FAILED_FETCHING_CUSTOMER',
        errors[0]?.message || errors[0],
      );
      return NotLoggedInResponse({
        url: checkoutUrl,
        error: `FAILED_FETCHING_CUSTOMER`,
      });
    }

    const {customer} = data as CustomerDataType;

    if (!customer) {
      return NotLoggedInResponse({
        url: checkoutUrl,
        error: `MISSING_CUSTOMER`,
      });
    }

    if (!customer?.email) {
      return NotLoggedInResponse({
        url: checkoutUrl,
        error: 'INVALID_CUSTOMER',
      });
    }

    try {
      // generate a multipass url and token
      const multipassify = new Multipassify();
      const multipass = await multipassify.init(
        Oxygen.env.SHOPIFY_STORE_MULTIPASS_SECRET,
      );

      const customerInfo = {
        ...customer,
        created_at: new Date().toISOString(),
        return_to: checkoutUrl, // target url
      };

      const url = await multipass.generateUrl(
        customerInfo,
        Oxygen.env.SHOPIFY_STORE_DOMAIN,
      );

      if (!url) {
        return NotLoggedInResponse({
          url: checkoutUrl,
          error: 'FAILED_GENERATING_MULTIPASS',
        });
      }

      // success
      return new Response(
        JSON.stringify({data: {url, loggedIn: true, error: null}}),
        {status: 200},
      );
    } catch (error) {
      let message = 'unknown error';
      if (error instanceof Error) {
        message = error.message;
      } else {
        message = JSON.stringify(error);
      }

      return NotLoggedInResponse({
        url: checkoutUrl ?? null,
        error: message,
      });
    }
  } catch (error) {
    let message = 'unknown error';
    if (error instanceof Error) {
      message = error.message;
      // eslint-disable-next-line no-console
      console.log('error.message:outter', error.message);
    } else {
      message = JSON.stringify(error);
    }

    return NotLoggedInResponse({
      url: null,
      error: message,
    });
  }
}

interface NotLoggedInResponse {
  url: string | null;
  error: string | null;
}

/*
  Helper response when errors occur.
*/
function NotLoggedInResponse(options: NotLoggedInResponse) {
  interface ErrorsType {
    [key: string]: string;
  }

  const ERRORS: ErrorsType = {
    MISSING_CHECKOUT_URL: 'Required checkoutUrl url was not provided.',
    MISSING_SESSION: 'No session found.',
    MISSING_CUSTOMER_ACCESS_TOKEN: 'No customerAccessToken found.',
    FAILED_FETCHING_CUSTOMER:
      'The was a problem fetching the associated customer.',
    MISSING_CUSTOMER: 'No associated customer data found.',
    INVALID_CUSTOMER: 'The associated customer data is not valid .',
    FAILED_GENERATING_MULTIPASS: 'Could not generate a multipass url.',
  };

  const {url, error: errorKey} = options;
  let error;
  if (!errorKey) {
    error = 'UNKNOWN_ERROR';
  } else {
    error = ERRORS[errorKey] ?? 'UNKNOWN_ERROR';
  }

  // always return the original url
  return new Response(JSON.stringify({data: {url, loggedIn: false}, error}), {
    status: 200,
    headers: {'Content-Type': 'application/json'},
  });
}

const CUSTOMER_INFO_QUERY = gql`
  query CustomerInfo($customerAccessToken: String!) {
    customer(customerAccessToken: $customerAccessToken) {
      firstName
      lastName
      phone
      email
    }
  }
`;
