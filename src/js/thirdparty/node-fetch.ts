import type * as s from "stream";

const {
  Headers: WebHeaders,
  Request: WebRequest,
  Response: WebResponse,
  Blob,
  File = Blob,
  FormData,
} = globalThis as any;
const nativeFetch = Bun.fetch;

// node-fetch extends from URLSearchParams in their implementation...
// https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/headers.js#L44
class Headers extends WebHeaders {
  raw() {
    const obj = this.toJSON();
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
const HeadersPrototype = Headers.prototype;

var BodyReadable;
function loadBodyReadable() {
  ({ _ReadableFromWebForUndici: BodyReadable } = require("node:stream")[Symbol.for("::bunternal::")]);
}

class Response extends WebResponse {
  [kBody]: any;
  [kHeaders];

  constructor(body, init) {
    const { Readable, Stream } = require("node:stream");
    if (body && typeof body === "object" && (body instanceof Stream || body instanceof Readable)) {
      body = Readable.toWeb(body);
    }

    super(body, init);
  }

  get body() {
    let body = this[kBody];
    if (!body) {
      var web = super.body;
      if (!web) return null;
      if (!BodyReadable) loadBodyReadable();
      body = this[kBody] = new BodyReadable({}, web);
    }

    return body;
  }

  get headers() {
    return (this[kHeaders] ??= Object.setPrototypeOf(super.headers, HeadersPrototype) as any);
  }

  clone() {
    return Object.setPrototypeOf(super.clone(this), ResponsePrototype);
  }

  async arrayBuffer() {
    // load the getter
    this.body;
    return await super.arrayBuffer();
  }

  async blob() {
    // load the getter
    this.body;
    return await super.blob();
  }

  async formData() {
    // load the getter
    this.body;
    return await super.formData();
  }

  async json() {
    // load the getter
    this.body;
    return await super.json();
  }

  // This is a deprecated function in node-fetch
  // but is still used by some libraries and frameworks (like Astro)
  async buffer() {
    // load the getter
    this.body;
    return new $Buffer(await super.arrayBuffer());
  }

  async text() {
    // load the getter
    this.body;
    return await super.text();
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
  [kUrl]: string;

  constructor(input, init) {
    // node-fetch is relaxed with the URL, for example, it allows "/" as a valid URL.
    // If it's not a valid URL, use a placeholder URL during construction.
    // See: https://github.com/oven-sh/bun/issues/4947
    if (typeof input === "string" && !URL.canParse(input)) {
      super(new URL(input, "http://localhost/"), init);
      this[kUrl] = input;
    } else {
      super(input, init);
      this[kUrl] = input.url;
    }
  }

  get url() {
    return this[kUrl];
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
async function fetch(url: any, init?: RequestInit & { body?: any }) {
  // input node stream -> web stream
  let body: s.Readable | undefined = init?.body;
  if (body) {
    const chunks: any = [];
    const { Readable } = require("node:stream");
    if (body instanceof Readable) {
      // TODO: Bun fetch() doesn't support ReadableStream at all.
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      init = { ...init, body: new Blob(chunks) };
    }
  }

  const response = await nativeFetch(url, init);
  Object.setPrototypeOf(response, ResponsePrototype);
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
  return Promise.resolve(Bun.file(path, options));
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
