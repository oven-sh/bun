// Users may override the global fetch implementation, so we need to ensure these are the originals.
const bindings = $cpp("NodeFetch.cpp", "createNodeFetchInternalBinding");
// undici-types declares these members as class properties; at runtime they are prototype accessors and
// methods, which the subclasses below override and reach through `super`.
interface WebResponseMembers {
  readonly body: ReadableStream | null;
  readonly headers: globalThis.Headers;
  readonly ok: boolean;
  readonly type: globalThis.Response["type"];
  clone(): globalThis.Response;
  text(): Promise<string>;
  json(): Promise<any>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
type WebResponseConstructor = new (
  body?: ConstructorParameters<typeof globalThis.Response>[0],
  init?: ConstructorParameters<typeof globalThis.Response>[1],
) => Omit<globalThis.Response, keyof WebResponseMembers> & WebResponseMembers;
interface WebRequestMembers {
  readonly url: string;
}
type WebRequestConstructor = new (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Omit<globalThis.Request, keyof WebRequestMembers> & WebRequestMembers;

const WebResponse: WebResponseConstructor = bindings[0];
const WebRequest: WebRequestConstructor = bindings[1];
const Blob: typeof globalThis.Blob = bindings[2];
const WebHeaders: typeof globalThis.Headers = bindings[3];
const FormData: typeof globalThis.FormData = bindings[4];
const File: typeof globalThis.File = bindings[5];
const nativeFetch = Bun.fetch;
const JSONParse = JSON.parse;

// node-fetch extends from URLSearchParams in their implementation...
// https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/headers.js#L44
class Headers extends WebHeaders {
  raw() {
    const obj: Record<string, string | string[]> = this.toJSON();
    for (const key in obj) {
      const val = obj[key];
      if (!$isJSArray(val)) {
        // They must all be arrays.
        obj[key] = [val];
      }
    }

    return obj;
  }

  // node-fetch inherits this due to URLSearchParams.
  // it also throws if you try to use it.
  sort() {
    throw new TypeError("Expected this to be instanceof URLSearchParams");
  }
}

const kHeaders = Symbol("kHeaders");
const kBody = Symbol("kBody");
// A fetched response has a body stream even when it has no body (204, HEAD):
// https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/index.js#L253-L286
const kFetched = Symbol("kFetched");
// The request's signal: an abort during the body read rejects with AbortError too.
const kSignal = Symbol("kSignal");
const HeadersPrototype = Headers.prototype;

function closeEmptyBody(controller) {
  controller.close();
}

// An old-style Stream (minipass, form-data's CombinedStream) is not a Readable, which Readable.toWeb() needs.
function readableFromOldStyleStream(source: import("node:stream").Stream) {
  const { PassThrough } = require("node:stream");
  const passthrough = new PassThrough();
  // pipe() does not forward "error", so a source that fails would leave the body open forever.
  source.on("error", err => {
    // After "end" the body is complete: https://github.com/node-fetch/node-fetch/blob/65ae25a1da2834b046c218685f2085a06f679492/src/body.js#L259-L268
    if (!passthrough.writableEnded) passthrough.destroy(err);
  });
  source.pipe(passthrough);
  return passthrough;
}

// The node stream of a fetched body emits AbortError when the request's signal aborts:
// https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/index.js#L70-L79
let FetchedBody;
function fetchedBody(response, web) {
  FetchedBody ??= class FetchedBody extends require("internal/webstreams_adapters")._ReadableFromWeb {
    destroy(error, callback) {
      if (error && this[kSignal]?.aborted) error = new AbortError("The operation was aborted.");
      return super.destroy(error, callback);
    }
  };
  const body = new FetchedBody({ responseBody: true }, web);
  body[kSignal] = response[kSignal];
  return body;
}

class Response extends WebResponse {
  [kBody]: any;
  [kHeaders];
  [kFetched]: boolean | undefined;
  [kSignal]: AbortSignal | undefined;

  constructor(body, init) {
    const { Readable, Stream } = require("node:stream");
    if (body && typeof body === "object" && (body instanceof Stream || body instanceof Readable)) {
      body = Readable.toWeb(body instanceof Readable ? body : readableFromOldStyleStream(body));
    }

    super(body, init);
  }

  get body() {
    let body = this[kBody];
    if (!body) {
      var web = super.body;
      if (!web) {
        if (!this[kFetched]) return null;
        web = new ReadableStream({ start: closeEmptyBody });
      }
      body = this[kBody] = fetchedBody(this, web);
    }

    return body;
  }

  // A body read that fails rejects with node-fetch's errors:
  // https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/body.js#L225-L249
  async arrayBuffer() {
    try {
      return await super.arrayBuffer();
    } catch (error) {
      throw toNodeFetchBodyError(error, this);
    }
  }

  async blob() {
    try {
      return await super.blob();
    } catch (error) {
      throw toNodeFetchBodyError(error, this);
    }
  }

  async formData() {
    try {
      return await super.formData();
    } catch (error) {
      throw toNodeFetchBodyError(error, this);
    }
  }

  async text() {
    try {
      return await super.text();
    } catch (error) {
      throw toNodeFetchBodyError(error, this);
    }
  }

  get headers() {
    return (this[kHeaders] ??= Object.setPrototypeOf(super.headers, HeadersPrototype) as any);
  }

  clone() {
    const cloned = Object.setPrototypeOf(super.clone(), ResponsePrototype);
    // clone() moved the body to a new web stream, so `body` gets a new node stream, as in node-fetch.
    this[kBody] = undefined;
    if (this[kFetched]) cloned[kFetched] = true;
    cloned[kSignal] = this[kSignal];
    return cloned;
  }

  // node-fetch parses the text, so an empty body rejects:
  // https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/body.js#L147-L150
  // The inherited json() resolves null for an empty fetched body (#24955).
  async json() {
    return JSONParse(await this.text());
  }

  // This is a deprecated function in node-fetch
  // but is still used by some libraries and frameworks (like Astro)
  async buffer() {
    return new $Buffer(await this.arrayBuffer());
  }

  get type() {
    if (!super.ok) {
      return "error";
    }

    return "default";
  }
}
var ResponsePrototype = Response.prototype;

const kUrl = Symbol("kUrl");

class Request extends WebRequest {
  [kUrl]?: string;

  constructor(input, init) {
    // node-fetch is relaxed with the URL, for example, it allows "/" as a valid URL.
    // If it's not a valid URL, use a placeholder URL during construction.
    // See: https://github.com/oven-sh/bun/issues/4947
    if (typeof input === "string" && !URL.canParse(input)) {
      super(new URL(input, "http://localhost/"), init);
      this[kUrl] = input;
    } else {
      super(input, init);
    }
  }

  get url() {
    return this[kUrl] ?? super.url;
  }
}

/**
 * `node-fetch` works like the browser-fetch API, except it's a little more strict on some features,
 * and uses node streams instead of web streams.
 *
 * It's overall a positive on speed to override the implementation, since most people will use something
 * like `.json()` or `.text()`, which is faster in Bun's native fetch, vs `node-fetch` going
 * through `node:http`, a node stream, then processing the data.
 */
async function fetch(
  // eslint-disable-next-line no-unused-vars
  url: any,

  // eslint-disable-next-line no-unused-vars
  init?: RequestInit & { body?: any },
) {
  // Convert Node.js streams to Web ReadableStream if they don't have Symbol.asyncIterator.
  // This is needed for libraries like `form-data` that use CombinedStream which extends
  // Node.js Stream but doesn't implement Symbol.asyncIterator.
  const initBody = init?.body;
  if (initBody && typeof initBody === "object" && !initBody[Symbol.asyncIterator]) {
    const { Readable, Stream } = require("node:stream");
    if (initBody instanceof Stream || initBody instanceof Readable) {
      const readable = initBody instanceof Readable ? initBody : readableFromOldStyleStream(initBody);
      init = { ...init, body: Readable.toWeb(readable) };
    }
  }
  const signal = init?.signal ?? url?.signal;
  let response;
  try {
    response = await nativeFetch.$call(undefined, url, init);
  } catch (error) {
    throw toNodeFetchError(error, url, signal);
  }
  Object.setPrototypeOf(response, ResponsePrototype);
  response[kFetched] = true;
  response[kSignal] = signal;
  return response;
}

// A failure of the transport is a system error and carries `errno`, as node's do. A bad argument
// (`ERR_INVALID_URL`, `ERR_INVALID_ARG_VALUE`, an invalid header name) or a used body does not.
function isSystemError(error) {
  return $isObject(error) && typeof error.errno === "number";
}

// node-fetch rejects with its own classes once the request started:
// https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/index.js#L70
// https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/index.js#L108-L179
function toNodeFetchError(error, url, signal) {
  // An abort rejects with AbortError whatever the signal's reason is.
  if (signal?.aborted) return new AbortError("The operation was aborted.");
  if (!isSystemError(error)) return error;
  const requestUrl = error.path || (typeof url === "string" ? url : (url?.url ?? String(url)));
  switch (error.code) {
    case "UnexpectedRedirect":
      return new FetchError(
        `uri requested responds with a redirect, redirect mode is set to error: ${requestUrl}`,
        "no-redirect",
      );
    case "TooManyRedirects":
      return new FetchError(`maximum redirect reached at: ${requestUrl}`, "max-redirect");
    case "RedirectURLInvalid":
      return new FetchError(`uri requested responds with an invalid redirect URL: ${requestUrl}`, "invalid-redirect");
    case "UnsupportedRedirectProtocol":
      return new FetchError(
        `uri requested responds with an unsupported redirect URL: ${requestUrl}`,
        "unsupported-redirect",
      );
  }
  return new FetchError(`request to ${requestUrl} failed, reason: ${error.message}`, "system", error);
}

function toNodeFetchBodyError(error, response) {
  if (response[kSignal]?.aborted) return new AbortError("The operation was aborted.");
  if (!isSystemError(error)) return error;
  return new FetchError(
    `Invalid response body while trying to fetch ${response.url}: ${error.message}`,
    "system",
    error,
  );
}

// https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/errors/base.js
class FetchBaseError extends Error {
  type: string;

  constructor(message, type) {
    super(message);
    this.type = type;
  }

  get name() {
    return this.constructor.name;
  }

  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
}

// https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/errors/fetch-error.js
class FetchError extends FetchBaseError {
  declare code?: string;
  declare errno?: string;
  declare erroredSysCall?: string;

  constructor(message, type, systemError) {
    super(message, type);
    if (systemError) {
      this.code = this.errno = systemError.code;
      this.erroredSysCall = systemError.syscall;
    }
  }
}

// node-fetch's AbortError is a FetchBaseError. This one stays a DOMException so that
// `error instanceof DOMException` keeps working on Bun, where fetch() rejected with one before.
class AbortError extends DOMException {
  type: string;

  constructor(message, type = "aborted") {
    super(message, "AbortError");
    this.type = type;
  }
}

function blobFrom(path, options) {
  return Promise.$resolve(Bun.file(path, options));
}

function blobFromSync(path, options) {
  return Bun.file(path, options);
}

var fileFrom = blobFrom;
var fileFromSync = blobFromSync;

function isRedirect(code) {
  return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
}

export default Object.assign(fetch, {
  AbortError,
  Blob,
  FetchBaseError,
  FetchError,
  File,
  FormData,
  Headers,
  Request,
  Response,
  blobFrom,
  blobFromSync,
  fileFrom,
  fileFromSync,
  isRedirect,
  fetch,
  default: fetch,
});
