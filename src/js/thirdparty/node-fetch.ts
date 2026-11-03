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
type WebResponseConstructor = Pick<typeof globalThis.Response, "error" | "json" | "redirect"> &
  (new (
    body?: ConstructorParameters<typeof globalThis.Response>[0],
    init?: ConstructorParameters<typeof globalThis.Response>[1],
  ) => Omit<globalThis.Response, keyof WebResponseMembers> & WebResponseMembers);
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
const HeadersPrototype = Headers.prototype;

function closeEmptyBody(controller: ReadableStreamDefaultController) {
  controller.close();
}

// An old-style Stream (minipass, form-data's CombinedStream) is not a Readable, which Readable.toWeb() needs.
function readableFromOldStyleStream(source: $Node.Stream) {
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

function webStreamFromOldStyleStream(source: $Node.Stream) {
  return require("node:stream").Readable.toWeb(readableFromOldStyleStream(source));
}

// Pipes the source on the first read, so a Request that is only inspected leaves a form-data body unread.
function lazyWebStreamFromOldStyleStream(source: $Node.Stream) {
  let reader: ReadableStreamDefaultReader | undefined;
  return new ReadableStream(
    {
      async pull(controller) {
        reader ??= webStreamFromOldStyleStream(source).getReader();
        const { done, value } = await reader!.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        return reader?.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

// `init` with one member replaced. A spread would drop its inherited and non-enumerable members.
function withMember(init, name: string, value): any {
  return { __proto__: init, [name]: value };
}

// An old-style Stream has no Symbol.asyncIterator, which is how native fetch() and Request read a node stream.
function withWebBody(init, toWebStream: typeof webStreamFromOldStyleStream) {
  const body = init?.body;
  return typeof body?.pipe === "function" &&
    !body[Symbol.asyncIterator] &&
    body instanceof require("node:stream").Stream
    ? withMember(init, "body", toWebStream(body))
    : init;
}

class Response extends WebResponse {
  [kBody]: any;
  [kHeaders];
  [kFetched]: boolean | undefined;

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
      body = this[kBody] = new (require("internal/webstreams_adapters")._ReadableFromWeb)({ responseBody: true }, web);
    }

    return body;
  }

  get headers() {
    return (this[kHeaders] ??= Object.setPrototypeOf(super.headers, HeadersPrototype) as any);
  }

  clone() {
    const cloned = Object.setPrototypeOf(super.clone(), ResponsePrototype);
    // clone() moved the body to a new web stream, so `body` gets a new node stream, as in node-fetch.
    this[kBody] = undefined;
    if (this[kFetched]) cloned[kFetched] = true;
    return cloned;
  }

  // node-fetch parses the text, so an empty body rejects:
  // https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/body.js#L147-L150
  // The inherited json() resolves null for an empty fetched body (#24955).
  async json() {
    return JSONParse(await super.text());
  }

  // This is a deprecated function in node-fetch
  // but is still used by some libraries and frameworks (like Astro)
  async buffer() {
    return new $Buffer(await super.arrayBuffer());
  }

  static error() {
    return Object.setPrototypeOf(super.error(), ResponsePrototype);
  }

  static json(data, init) {
    return Object.setPrototypeOf(super.json(data, init), ResponsePrototype);
  }

  static redirect(url, status) {
    return Object.setPrototypeOf(super.redirect(url, status), ResponsePrototype);
  }

  // https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/response.js#L121-L125
  get type() {
    return super.type === "error" ? "error" : "default";
  }
}
var ResponsePrototype = Response.prototype;

const kUrl = Symbol("kUrl");
const ObjectHasOwn = Object.hasOwn;

// https.Agent applies `agent.options` to every tls.connect() it makes.
function tlsFromAgent(agent, url) {
  if ($isCallable(agent)) {
    const href = $isObject(url) ? (url.href ?? url.url) : url;
    if (typeof href !== "string" || !URL.canParse(href)) return undefined;
    agent = agent.$call(undefined, new URL(href));
  }
  if (!$isObject(agent) || !ObjectHasOwn(agent, "options") || !$isObject(agent.options)) return undefined;
  return require("internal/tls").nodeClientTlsToNative({ __proto__: null, ...agent.options });
}

class Request extends WebRequest {
  [kUrl]?: string;

  constructor(input, init) {
    init = withWebBody(init, lazyWebStreamFromOldStyleStream);

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
  if (init && ObjectHasOwn(init, "agent") && (init as any).agent && (init as any).tls === undefined) {
    const tls = tlsFromAgent((init as any).agent, url);
    if (tls !== undefined) init = withMember(init, "tls", tls);
  }
  init = withWebBody(init, webStreamFromOldStyleStream);
  let response;
  try {
    response = await nativeFetch.$call(undefined, url, init);
  } catch (error) {
    throw toNodeFetchError(error);
  }
  Object.setPrototypeOf(response, ResponsePrototype);
  response[kFetched] = true;
  return response;
}

// https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/index.js#L70-L217
function toNodeFetchError(error) {
  // An abort with a reason of its own, such as AbortSignal.timeout(), keeps rejecting with that reason.
  if (error instanceof DOMException) return error.name === "AbortError" ? new AbortError(error.message) : error;
  // Native fetch() sets a numeric `errno` on a request that failed, and none on a bad argument.
  if (!(error instanceof TypeError) || typeof (error as any).errno !== "number") return error;
  const { code, path } = error as any;
  const message = `request to ${path} failed, reason: ${error.message}`;
  switch (code) {
    case "UnexpectedRedirect":
      return new FetchError(
        `uri requested responds with a redirect, redirect mode is set to error: ${path}`,
        "no-redirect",
      );
    case "TooManyRedirects":
      return new FetchError(`maximum redirect reached at: ${path}`, "max-redirect");
    case "RedirectURLInvalid":
      return new FetchError(message, "invalid-redirect");
    case "UnsupportedRedirectProtocol":
      return error;
  }
  return new FetchError(message, "system", error);
}

// Stays a DOMException, unlike node-fetch's AbortError, so `instanceof DOMException` still matches an aborted fetch().
class AbortError extends DOMException {
  type: string;

  constructor(message, type = "aborted") {
    super(message, "AbortError");
    this.type = type;
  }
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

  constructor(message, type, systemError?) {
    super(message, type);
    if (systemError) {
      this.code = this.errno = systemError.code;
      this.erroredSysCall = systemError.syscall;
    }
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
