/*
 * This file does not declare any global types.
 *
 * That should only happen in [./globals.d.ts](./globals.d.ts)
 * so that our documentation generator can pick it up, as it
 * expects all globals to be declared in one file.
 *
 * This may change in the future, which would be
 * a nice thing as it would allow us to split up
 * relevant types into their own files.
 */
declare module "bun" {
  type HeadersInit = string[][] | Record<string, string | ReadonlyArray<string>> | Headers;
  type BodyInit =
    | ReadableStream
    | Bun.XMLHttpRequestBodyInit
    // Extras that Bun supports:
    | AsyncIterable<string | ArrayBuffer | ArrayBufferView>
    | AsyncGenerator<string | ArrayBuffer | ArrayBufferView>
    | (() => AsyncGenerator<string | ArrayBuffer | ArrayBufferView>)
    | import("bun").Image;

  namespace __internal {
    type LibOrFallbackHeaders = LibDomIsLoaded extends true ? {} : import("undici-types").Headers;
    type LibOrFallbackRequest = LibDomIsLoaded extends true ? {} : import("undici-types").Request;
    type LibOrFallbackResponse = LibDomIsLoaded extends true ? {} : import("undici-types").Response;
    type LibOrFallbackResponseInit = LibDomIsLoaded extends true ? {} : import("undici-types").ResponseInit;
    type LibOrFallbackRequestInit = LibDomIsLoaded extends true
      ? {}
      : Omit<import("undici-types").RequestInit, "body" | "headers"> & {
          body?: Bun.BodyInit | null | undefined;
          headers?: Bun.HeadersInit | undefined;
        };

    interface BunHeadersOverride extends LibOrFallbackHeaders {
      /**
       * Converts {@link Headers} to a plain JavaScript object.
       *
       * About 10x faster than `Object.fromEntries(headers.entries())`.
       *
       * Called when you run `JSON.stringify(headers)`.
       *
       * Does not preserve insertion order. Well-known header names are lowercased; other header names are left as-is.
       */
      toJSON(): Record<string, string> & { "set-cookie"?: string[] };

      /**
       * The number of headers.
       */
      readonly count: number;

      /**
       * Gets all values for the given header name.
       *
       * Only `"Set-Cookie"` is supported. Any other header name returns an empty array.
       *
       * @param name The header name
       *
       * @returns The header's values
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
      /**
       * Returns a {@link ReadableStream} of the body decoded as UTF-8 text.
       *
       * Multi-byte characters split across chunk boundaries are joined
       * correctly. Throws a {@link TypeError} if the body has already been
       * consumed or is locked.
       */
      textStream(): ReadableStream<string>;
    }

    interface BunResponseOverride extends LibOrFallbackResponse {
      headers: BunHeadersOverride;
      /**
       * Returns a {@link ReadableStream} of the body decoded as UTF-8 text.
       *
       * Multi-byte characters split across chunk boundaries are joined
       * correctly. Throws a {@link TypeError} if the body has already been
       * consumed or is locked.
       */
      textStream(): ReadableStream<string>;
    }
  }
}
