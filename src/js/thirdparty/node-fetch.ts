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
const StringPrototypeToUpperCase = String.prototype.toUpperCase;
const BufferByteLength = Buffer.byteLength;

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

// A setEncoding() source emits strings, which the default ByteLengthQueuingStrategy cannot size.
function chunkByteLength(chunk: string | ArrayBufferView) {
  return typeof chunk === "string" ? BufferByteLength(chunk) : chunk.byteLength;
}

function isNodeStream(body): body is $Node.Stream | $Node.Readable {
  if (!body || typeof body !== "object" || typeof body.pipe !== "function") return false;
  const { Readable, Stream } = require("node:stream");
  return body instanceof Stream || body instanceof Readable;
}

/** Subscribes to the stream at once: every chunk goes to the web stream and to any later "data" listener. */
function webStreamFromNodeStream(source: $Node.Stream | $Node.Readable) {
  const { Readable } = require("node:stream");
  const readable = source instanceof Readable ? source : readableFromOldStyleStream(source);
  return Readable.toWeb(
    readable,
    readable.readableObjectMode
      ? undefined
      : { strategy: { highWaterMark: readable.readableHighWaterMark, size: chunkByteLength } },
  );
}

class Response extends WebResponse {
  [kBody]: any;
  [kHeaders];
  [kFetched]: boolean | undefined;

  constructor(body, init) {
    if (isNodeStream(body)) body = webStreamFromNodeStream(body);

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

  get type() {
    if (!super.ok) {
      return "error";
    }

    return "default";
  }
}
var ResponsePrototype = Response.prototype;

const kUrl = Symbol("kUrl");
// The Node stream body of a Request, for fetch(request) to subscribe to. null once used.
const kNodeBody = Symbol("kNodeBody");
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
  [kNodeBody]?: $Node.Stream | $Node.Readable | null;

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
    const body = init?.body;
    if (isNodeStream(body)) this[kNodeBody] = body;
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
  // node-fetch pipes a stream body inside fetch(), before a later "data" listener can drain it.
  const initBody = init?.body;
  let body = initBody;
  if (body === undefined && $isObject(url)) {
    body = url[kNodeBody];
    if (body === null) throw new TypeError("Body object should not be disturbed or locked");
  }
  if (isNodeStream(body)) {
    // The native fetch rejects a GET or HEAD request (the default) with a body, so that stream stays untouched.
    let method = init?.method ?? ($isObject(url) ? url.method : undefined);
    method = method === undefined ? "GET" : StringPrototypeToUpperCase.$call(`${method}`);
    if (method !== "GET" && method !== "HEAD") {
      init = { ...init, body: webStreamFromNodeStream(body) };
      if (initBody === undefined) url[kNodeBody] = null;
    }
  }
  if (init && ObjectHasOwn(init, "agent") && (init as any).agent && (init as any).tls === undefined) {
    const tls = tlsFromAgent((init as any).agent, url);
    if (tls !== undefined) init = { ...init, tls } as any;
  }
  const response = await nativeFetch.$call(undefined, url, init);
  Object.setPrototypeOf(response, ResponsePrototype);
  response[kFetched] = true;
  return response;
}

class AbortError extends DOMException {
  constructor(message) {
    super(message, "AbortError");
  }
}

class FetchBaseError extends Error {
  type: string;

  constructor(message, type) {
    super(message);
    this.type = type;
  }
}

class FetchError extends FetchBaseError {
  constructor(message, type, systemError) {
    super(message, type);
    this.code = systemError?.code;
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
