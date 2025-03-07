type RequestInit = import("undici-types").RequestInit;
type HeadersInit = import("undici-types").HeadersInit;
type ResponseInit = import("undici-types").ResponseInit;
type BodyInit = import("undici-types").BodyInit;

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

declare var Headers: {
	prototype: Headers;
	new (init?: HeadersInit): Headers;
};

interface Request {
	headers: Headers;
}

declare var Request: {
	prototype: Request;
	new (requestInfo: string, requestInit?: RequestInit): Request;
	new (requestInfo: RequestInit & { url: string }): Request;
	new (requestInfo: Request, requestInit?: RequestInit): Request;
};

declare var Response: {
	new (
		body?: BodyInit | null | undefined,
		init?: ResponseInit | undefined,
	): Response;
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
	json(body?: any, options?: ResponseInit | number): Response;

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

interface BunFetchRequestInitTLS extends Bun.TLSOptions {
	/**
	 * Custom function to check the server identity
	 * @param hostname - The hostname of the server
	 * @param cert - The certificate of the server
	 * @returns An error if the server is unauthorized, otherwise undefined
	 */
	checkServerIdentity?: NonNullable<
		import("node:tls").ConnectionOptions["checkServerIdentity"]
	>;
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
}

/**
 * Send a HTTP(s) request
 *
 * @param request Request object
 * @param init A structured value that contains settings for the fetch() request.
 *
 * @returns A promise that resolves to {@link Response} object.
 */
declare function fetch(
	request: Request,
	init?: BunFetchRequestInit,
): Promise<Response>;
/**
 * Send a HTTP(s) request
 *
 * @param url URL string
 * @param init A structured value that contains settings for the fetch() request.
 *
 * @returns A promise that resolves to {@link Response} object.
 */
declare function fetch(
	url: string | URL | Request,
	init?: BunFetchRequestInit,
): Promise<Response>;

/**
 * Send a HTTP(s) request
 *
 * @param input URL string or Request object
 * @param init A structured value that contains settings for the fetch() request.
 *
 * @returns A promise that resolves to {@link Response} object.
 */
declare function fetch(
	input: string | URL | globalThis.Request,
	init?: BunFetchRequestInit,
): Promise<Response>;

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
