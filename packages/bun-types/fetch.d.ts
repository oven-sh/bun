declare module "bun" {
  type BodyInit = ReadableStream | Bun.XMLHttpRequestBodyInit | URLSearchParams;
  type HeadersInit = Headers | Record<string, string> | Array<[string, string]> | IterableIterator<[string, string]>;
  type ResponseType = "basic" | "cors" | "default" | "error" | "opaque" | "opaqueredirect";

  // Required to expose `Bun.RequestInit` & `Bun.ResponseInit`
  interface ResponseInit extends Bun.__internal.LibOrFallbackResponseInit {}
  interface RequestInit extends Bun.__internal.LibOrFallbackRequestInit {}

  namespace __internal {
    type LibOrFallbackHeaders = LibDomIsLoaded extends true ? {} : import("undici-types").Headers;
    type LibOrFallbackRequest = LibDomIsLoaded extends true ? {} : import("undici-types").Request;
    type LibOrFallbackResponse = LibDomIsLoaded extends true ? {} : import("undici-types").Response;
    type LibOrFallbackResponseInit = LibDomIsLoaded extends true ? {} : import("undici-types").ResponseInit;
    type LibOrFallbackRequestInit = LibDomIsLoaded extends true
      ? {}
      : Omit<import("undici-types").RequestInit, "body"> & { body?: BodyInit | null | undefined };

    interface BunHeadersOverride extends LibOrFallbackHeaders {
      /**
       * Convert {@link Headers} to a plain JavaScript object.
       *
       * About 10x faster than `Object.fromEntries(headers.entries())`
       *
       * Called when you run `JSON.stringify(headers)`
       *
       * Does not preserve insertion order. Well-known header names are lowercased. Other header names are left as-is.
       */
      toJSON(): Record<string, string>;

      /**
       * Get the total number of headers
       */
      readonly count: number;

      /**
       * Get all headers matching the name
       *
       * Only supports `"Set-Cookie"`. All other headers are empty arrays.
       *
       * @param name - The header name to get
       *
       * @returns An array of header values
       *
       * @example
       * ```ts
       * const headers = new Headers();
       * headers.append("Set-Cookie", "foo=bar");
       * headers.append("Set-Cookie", "baz=qux");
       * headers.getAll("Set-Cookie"); // ["foo=bar", "baz=qux"]
       * ```
       */
      getAll(name: "set-cookie" | "Set-Cookie"): string[];
    }

    interface BunRequestOverride extends LibOrFallbackRequest {
      headers: BunHeadersOverride;
    }

    interface BunResponseOverride extends LibOrFallbackResponse {
      headers: BunHeadersOverride;
    }
  }
}

interface RequestInit extends Bun.RequestInit {}
interface ResponseInit extends Bun.ResponseInit {}

interface Headers extends Bun.__internal.BunHeadersOverride {}
declare var Headers: Bun.__internal.UseLibDomIfAvailable<
  "Headers",
  {
    prototype: Headers;
    new (init?: Bun.HeadersInit): Headers;
  }
>;

interface Request extends Bun.__internal.BunRequestOverride {}
declare var Request: Bun.__internal.UseLibDomIfAvailable<
  "Request",
  {
    prototype: Request;
    new (requestInfo: string, init?: RequestInit): Request;
    new (requestInfo: RequestInit & { url: string }): Request;
    new (requestInfo: Request, init?: RequestInit): Request;
  }
>;

interface Response extends Bun.__internal.BunResponseOverride {}
declare var Response: Bun.__internal.UseLibDomIfAvailable<
  "Response",
  {
    new (body?: Bun.BodyInit | null | undefined, init?: ResponseInit | undefined): Response;
    /**
     * Create a new {@link Response} with a JSON body
     *
     * @param body - The body of the response
     * @param options - options to pass to the response
     *
     * @example
     *
     * ```ts
     * const response = Response.json({hi: "there"});
     * console.assert(
     *   await response.text(),
     *   `{"hi":"there"}`
     * );
     * ```
     * -------
     *
     * This is syntactic sugar for:
     * ```js
     *  new Response(JSON.stringify(body), {headers: { "Content-Type": "application/json" }})
     * ```
     * @link https://github.com/whatwg/fetch/issues/1389
     */
    json(body?: any, init?: ResponseInit | number): Response;

    /**
     * Create a new {@link Response} that redirects to url
     *
     * @param url - the URL to redirect to
     * @param status - the HTTP status code to use for the redirect
     */
    redirect(url: string, status?: number): Response;

    /**
     * Create a new {@link Response} that redirects to url
     *
     * @param url - the URL to redirect to
     * @param options - options to pass to the response
     */
    redirect(url: string, init?: ResponseInit): Response;

    /**
     * Create a new {@link Response} that has a network error
     */
    error(): Response;
  }
>;

interface BunFetchRequestInitTLS extends Bun.TLSOptions {
  /**
   * Custom function to check the server identity
   * @param hostname - The hostname of the server
   * @param cert - The certificate of the server
   * @returns An error if the server is unauthorized, otherwise undefined
   */
  checkServerIdentity?: NonNullable<import("node:tls").ConnectionOptions["checkServerIdentity"]>;
}

/**
 * BunFetchRequestInit represents additional options that Bun supports in `fetch()` only.
 *
 * Bun extends the `fetch` API with some additional options, except
 * this interface is not quite a `RequestInit`, because they won't work
 * if passed to `new Request()`. This is why it's a separate type.
 */
interface BunFetchRequestInit extends RequestInit {
  /**
   * Override the default TLS options
   */
  tls?: BunFetchRequestInitTLS;

  /**
   * Log the raw HTTP request & response to stdout. This API may be
   * removed in a future version of Bun without notice.
   * This is a custom property that is not part of the Fetch API specification.
   * It exists mostly as a debugging tool
   */
  verbose?: boolean;

  /**
   * Override http_proxy or HTTPS_PROXY
   * This is a custom property that is not part of the Fetch API specification.
   */
  proxy?: string;

  /**
   * Override the default S3 options
   */
  s3?: Bun.S3Options;
}

/**
 * Send a HTTP(s) request
 *
 * @param request Request object
 * @param init A structured value that contains settings for the fetch() request.
 *
 * @returns A promise that resolves to {@link Response} object.
 */
declare function fetch(request: Request, init?: BunFetchRequestInit): Promise<Response>;

/**
 * Send a HTTP(s) request
 *
 * @param url URL string
 * @param init A structured value that contains settings for the fetch() request.
 *
 * @returns A promise that resolves to {@link Response} object.
 */
declare function fetch(url: string | URL | Request, init?: BunFetchRequestInit): Promise<Response>;

/**
 * Send a HTTP(s) request
 *
 * @param input URL string or Request object
 * @param init A structured value that contains settings for the fetch() request.
 *
 * @returns A promise that resolves to {@link Response} object.
 */
declare function fetch(input: string | URL | Request, init?: BunFetchRequestInit): Promise<Response>;

declare namespace fetch {
  export function preconnect(
    url: string | URL,
    options?: {
      dns?: boolean;
      tcp?: boolean;
      http?: boolean;
      https?: boolean;
    },
  ): void;
}
