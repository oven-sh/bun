/*

  This file does not declare any global types.

  That should only happen in [./globals.d.ts](./globals.d.ts)
  so that our documentation generator can pick it up, as it
  expects all globals to be declared in one file.

 */

declare module "bun" {
  type HeadersInit = string[][] | Record<string, string | ReadonlyArray<string>> | Headers;
  type BodyInit =
    | ReadableStream
    | Bun.XMLHttpRequestBodyInit
    | URLSearchParams
    | AsyncGenerator<string | ArrayBuffer | ArrayBufferView>
    | (() => AsyncGenerator<string | ArrayBuffer | ArrayBufferView>);

  namespace __internal {
    type LibOrFallbackHeaders = LibDomIsLoaded extends true ? {} : import("undici-types").Headers;
    type LibOrFallbackRequest = LibDomIsLoaded extends true ? {} : import("undici-types").Request;

    type LibOrFallbackResponse = LibDomIsLoaded extends true
      ? {}
      : {
          readonly headers: Headers;
          readonly ok: boolean;
          readonly status: number;
          readonly statusText: string;
          readonly url: string;
          readonly redirected: boolean;

          get body(): ReadableStream | null;
          get bodyUsed(): boolean;

          get type(): import("undici-types").ResponseType;

          arrayBuffer(): Promise<ArrayBuffer>;
          blob(): Promise<Blob>;
          formData(): Promise<FormData>;
          json(): Promise<unknown>;
          text(): Promise<string>;

          clone(): Response;
        };

    type LibOrFallbackResponseInit = LibDomIsLoaded extends true ? {} : import("undici-types").ResponseInit;
    type LibOrFallbackRequestInit = LibDomIsLoaded extends true
      ? {}
      : Omit<import("undici-types").RequestInit, "body" | "headers"> & {
          body?: Bun.BodyInit | null | undefined;
          headers?: Bun.HeadersInit;
        };

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
      toJSON(): Record<string, string> & { "set-cookie"?: string[] };

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

    interface BunResponseConstructorOverride {
      new (body?: Bun.BodyInit | null | undefined, init?: ResponseInit | undefined): BunResponseOverride;
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
  }
}
