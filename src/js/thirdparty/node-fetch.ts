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
  clone(): globalThis.Request;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<globalThis.Blob>;
  bytes(): Promise<Uint8Array>;
  formData(): Promise<globalThis.FormData>;
  json(): Promise<any>;
  text(): Promise<string>;
  textStream(): ReadableStream<string>;
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
const ObjectCreate = Object.create;

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

  get type() {
    if (!super.ok) {
      return "error";
    }

    return "default";
  }
}
var ResponsePrototype = Response.prototype;

const kUrl = Symbol("kUrl");
const kStartBody = Symbol("kStartBody");

// Like node-fetch, this reads the source when the body is used: a caller can build a Request only to inspect it.
function lazyBodyFromOldStyleStream(source: import("node:stream").Stream) {
  let reader: ReadableStreamDefaultReader | undefined;
  // The source failed, or the body was canceled, before the read began. The source is then never read.
  let finished = false;
  let failure: unknown;
  // As in node-fetch, the source has an "error" listener from the constructor on.
  source.on("error", err => {
    if (!reader && !finished) {
      finished = true;
      failure = err;
    }
  });
  // The native consumers pull a microtask late. A caller that can runs this first, for a source that emits at once.
  function start() {
    if (reader || finished) return;
    try {
      reader = require("node:stream").Readable.toWeb(readableFromOldStyleStream(source)).getReader();
    } catch (err) {
      // A pipe() that throws fails the body, not the caller of text() or fetch().
      finished = true;
      failure = err;
    }
  }
  const stream = new ReadableStream(
    {
      async pull(controller) {
        start();
        if (!reader) return controller.error(failure);
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        if (reader) return reader.cancel(reason);
        finished = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, start };
}

// The native side takes the body of a Request input when init has no `body` (null is one), else of a Request as init.
function startTakenBody(input, init, initBody) {
  (initBody === undefined ? input : init)?.[kStartBody]?.();
}

class Request extends WebRequest {
  [kUrl]?: string;
  declare [kStartBody]?: () => void;

  constructor(input, init) {
    // The native Request turns a Stream without Symbol.asyncIterator (form-data) into the text "[object Object]".
    const body = init?.body;
    let startBody: (() => void) | undefined;
    if (typeof body?.pipe === "function" && !body[Symbol.asyncIterator]) {
      if (body instanceof require("node:stream").Stream) {
        const lazy = lazyBodyFromOldStyleStream(body);
        // Inherits from `init` and is not a copy, because a copy loses the members that `init` itself inherits.
        init = ObjectCreate(init, {
          body: { value: lazy.stream },
          // node-fetch has no `keepalive`, and the native Request refuses it with a stream body.
          keepalive: { value: undefined },
        });
        startBody = lazy.start;
      }
    }

    // node-fetch is relaxed with the URL, for example, it allows "/" as a valid URL.
    // If it's not a valid URL, use a placeholder URL during construction.
    // See: https://github.com/oven-sh/bun/issues/4947
    if (typeof input === "string" && !URL.canParse(input)) {
      super(new URL(input, "http://localhost/"), init);
      this[kUrl] = input;
    } else {
      super(input, init);
    }
    if (startBody) this[kStartBody] = startBody;
    else startTakenBody(input, init, body);
  }

  get url() {
    return this[kUrl] ?? super.url;
  }

  // clone() and the body methods use the body. Each begins the read before it returns.
  clone() {
    this?.[kStartBody]?.();
    const cloned = Object.setPrototypeOf(super.clone(), RequestPrototype);
    if (this[kUrl] !== undefined) cloned[kUrl] = this[kUrl];
    return cloned;
  }

  arrayBuffer() {
    this?.[kStartBody]?.();
    return super.arrayBuffer();
  }

  blob() {
    this?.[kStartBody]?.();
    return super.blob();
  }

  bytes() {
    this?.[kStartBody]?.();
    return super.bytes();
  }

  formData() {
    this?.[kStartBody]?.();
    return super.formData();
  }

  json() {
    this?.[kStartBody]?.();
    return super.json();
  }

  text() {
    this?.[kStartBody]?.();
    return super.text();
  }

  textStream() {
    this?.[kStartBody]?.();
    return super.textStream();
  }
}
var RequestPrototype = Request.prototype;

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
      init = ObjectCreate(init!, { body: { value: Readable.toWeb(readable) } });
    }
  }
  startTakenBody(url, init, initBody);
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
