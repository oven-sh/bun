type _Request = import("undici-types").Request;
type _Headers = import("undici-types").Headers;
type _Response = import("undici-types").Response;

export {};

declare global {
	var Response: {
		new (
			body?: Bun.BodyInit | null | undefined,
			init?: Bun.ResponseInit | undefined,
		): _Response;

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

	interface Request extends _Request {
		headers: Headers;
	}

	var Request: {
		prototype: Request;
		new (requestInfo: string, requestInit?: RequestInit): Request;
		new (requestInfo: RequestInit & { url: string }): Request;
		new (requestInfo: Request, requestInit?: RequestInit): Request;
	};

	interface Headers extends _Headers {
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
}
