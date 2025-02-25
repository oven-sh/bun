interface Headers {
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

var Headers: {
  prototype: Headers;
  new (init?: Bun.HeadersInit): Headers;
};

interface Request {
  headers: Headers;
}

var Request: {
  prototype: Request;
  new (requestInfo: string, requestInit?: RequestInit): Request;
  new (requestInfo: RequestInit & { url: string }): Request;
  new (requestInfo: Request, requestInit?: RequestInit): Request;
};

var Response: {
  new (body?: Bun.BodyInit | null | undefined, init?: Bun.ResponseInit | undefined): Response;
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
  json(body?: any, options?: Bun.ResponseInit | number): Response;

  /**
   * Create a new {@link Response} that redirects to url
   *
   * @param url - the URL to redirect to
   * @param status - the HTTP status code to use for the redirect
   */
  // tslint:disable-next-line:unified-signatures
  redirect(url: string, status?: number): Response;

  /**
   * Create a new {@link Response} that redirects to url
   *
   * @param url - the URL to redirect to
   * @param options - options to pass to the response
   */
  // tslint:disable-next-line:unified-signatures
  redirect(url: string, options?: Bun.ResponseInit): Response;

  /**
   * Create a new {@link Response} that has a network error
   */
  error(): Response;
};

var fetch: {
  /**
   * Send a HTTP(s) request
   *
   * @param request Request object
   * @param init A structured value that contains settings for the fetch() request.
   *
   * @returns A promise that resolves to {@link Response} object.
   */
  (request: Request, init?: RequestInit): Promise<Response>;

  /**
   * Send a HTTP(s) request
   *
   * @param url URL string
   * @param init A structured value that contains settings for the fetch() request.
   *
   * @returns A promise that resolves to {@link Response} object.
   */
  (url: string | URL | Request, init?: RequestInit): Promise<Response>;

  (input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response>;

  /**
   * Start the DNS resolution, TCP connection, and TLS handshake for a request
   * before the request is actually sent.
   *
   * This can reduce the latency of a request when you know there's some
   * long-running task that will delay the request starting.
   *
   * This is a bun-specific API and is not part of the Fetch API specification.
   */
  preconnect(url: string | URL): void;
};
