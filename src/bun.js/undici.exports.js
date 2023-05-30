// const { Object } = import.meta.primordials;
const { EventEmitter } = import.meta.require("events");
const {
  Readable,
  [Symbol.for("::bunternal::")]: { _ReadableFromWeb },
} = import.meta.require("node:stream");

const ObjectCreate = Object.create;
const kEmptyObject = ObjectCreate(null);

export var fetch = Bun.fetch;
export var Response = globalThis.Response;
export var Headers = globalThis.Headers;
export var Request = globalThis.Request;
export var URLSearchParams = globalThis.URLSearchParams;
export var URL = globalThis.URL;
export class File extends Blob {}
export class FileReader extends EventTarget {
  constructor() {
    throw new Error("Not implemented yet!");
  }
}

export var FormData = globalThis.FormData;
function notImplemented() {
  throw new Error("Not implemented in bun");
}

/**
 * An object representing a URL.
 * @typedef {Object} UrlObject
 * @property {string | number} [port]
 * @property {string} [path]
 * @property {string} [pathname]
 * @property {string} [hostname]
 * @property {string} [origin]
 * @property {string} [protocol]
 * @property {string} [search]
 */

/**
 * @typedef {import('http').IncomingHttpHeaders} IncomingHttpHeaders
 * @typedef {'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'PATCH'} HttpMethod
 * @typedef {import('stream').Readable} Readable
 * @typedef {import('events').EventEmitter} EventEmitter
 */

class BodyReadable extends _ReadableFromWeb {
  #response;
  #bodyUsed;

  constructor(response, options = {}) {
    var { body } = response;
    if (!body) throw new Error("Response body is null");
    super(options, body);

    this.#response = response;
    this.#bodyUsed = response.bodyUsed;
  }

  get bodyUsed() {
    // return this.#response.bodyUsed;
    return this.#bodyUsed;
  }

  #consume() {
    if (this.#bodyUsed) throw new TypeError("unusable");
    this.#bodyUsed = true;
  }

  async arrayBuffer() {
    this.#consume();
    return await this.#response.arrayBuffer();
  }

  async blob() {
    this.#consume();
    return await this.#response.blob();
  }

  async formData() {
    this.#consume();
    return await this.#response.formData();
  }

  async json() {
    this.#consume();
    return await this.#response.json();
  }

  async text() {
    this.#consume();
    return await this.#response.text();
  }
}

// NOT IMPLEMENTED
// *   idempotent?: boolean;
// *   onInfo?: (info: { statusCode: number, headers: Object<string, string | string[]> }) => void;
// *   opaque?: *;
// *   responseHeader: 'raw' | null;
// *   headersTimeout?: number | null;
// *   bodyTimeout?: number | null;
// *   upgrade?: boolean | string | null;
// *   blocking?: boolean;

/**
 * Performs an HTTP request.
 * @param {string | URL | UrlObject} url
 * @param {{
 *   dispatcher: Dispatcher;
 *   method: HttpMethod;
 *   signal?: AbortSignal | EventEmitter | null;
 *   maxRedirections?: number;
 *   body?: string | Buffer | Uint8Array | Readable | null | FormData;
 *   headers?: IncomingHttpHeaders | string[] | null;
 *   query?: Record<string, any>;
 *   reset?: boolean;
 *   throwOnError?: boolean;
 * }} [options]
 * @returns {{
 *   statusCode: number;
 *   headers: IncomingHttpHeaders;
 *   body: ResponseBody;
 *   trailers: Object<string, string>;
 *   opaque: *;
 *   context: Object<string, *>;
 * }}
 */
export async function request(
  url,
  options = {
    method: "GET",
    signal: null,
    headers: null,
    query: null,
    // idempotent: false, // GET and HEAD requests are idempotent by default
    // blocking = false,
    // upgrade = false,
    // headersTimeout: 30000,
    // bodyTimeout: 30000,
    reset: false,
    throwOnError: false,
    body: null,
    // dispatcher,
  },
) {
  let {
    method = "GET",
    headers: inputHeaders,
    query,
    signal,
    // idempotent, // GET and HEAD requests are idempotent by default
    // blocking = false,
    // upgrade = false,
    // headersTimeout = 30000,
    // bodyTimeout = 30000,
    reset = false,
    throwOnError = false,
    body: inputBody,
    maxRedirections,
    // dispatcher,
  } = options;

  // TODO: More validations

  if (typeof url === "string") {
    if (query) url = new URL(url);
  } else if (typeof url === "object" && url !== null) {
    if (!(url instanceof URL)) {
      // TODO: Parse undici UrlObject
      throw new Error("not implemented");
    }
  } else throw new TypeError("url must be a string, URL, or UrlObject");

  if (typeof url === "string" && query) url = new URL(url);
  if (typeof url === "object" && url !== null && query) if (query) url.search = new URLSearchParams(query).toString();

  method = method && typeof method === "string" ? method.toUpperCase() : null;
  // idempotent = idempotent === undefined ? method === "GET" || method === "HEAD" : idempotent;

  if (inputBody && (method === "GET" || method === "HEAD")) {
    throw new Error("Body not allowed for GET or HEAD requests");
  }

  if (inputBody && inputBody.read && inputBody instanceof Readable) {
    // TODO: Streaming via ReadableStream?
    let data = "";
    inputBody.setEncoding("utf8");
    for await (const chunk of stream) {
      data += chunk;
    }
    inputBody = new TextEncoder().encode(data);
  }

  if (maxRedirections !== undefined && Number.isNaN(maxRedirections)) {
    throw new Error("maxRedirections must be a number if defined");
  }

  if (signal && !(signal instanceof AbortSignal)) {
    // TODO: Add support for event emitter signal
    throw new Error("signal must be an instance of AbortSignal");
  }

  let resp;
  /** @type {Response} */
  const {
    status: statusCode,
    headers,
    trailers,
  } = (resp = await fetch(url, {
    signal,
    mode: "cors",
    method,
    headers: inputHeaders || kEmptyObject,
    body: inputBody,
    redirect: maxRedirections === "undefined" || maxRedirections > 0 ? "follow" : "manual",
    keepalive: !reset,
  }));

  // Throw if received 4xx or 5xx response indicating HTTP error
  if (throwOnError && statusCode >= 400 && statusCode < 600) {
    throw new Error(`Request failed with status code ${statusCode}`);
  }

  const body = resp.body ? new BodyReadable(resp) : null;

  const headersObject = {};
  for (const [key, value] of headers.entries()) {
    headersObject[key] = value;
  }

  return { statusCode, headers: headersObject, body, trailers, opaque: kEmptyObject, context: kEmptyObject };
}

export function stream() {
  throw new Error("Not implemented in bun");
}
export function pipeline() {
  throw new Error("Not implemented in bun");
}
export function connect() {
  throw new Error("Not implemented in bun");
}
export function upgrade() {
  throw new Error("Not implemented in bun");
}

export class MockClient {
  constructor() {
    throw new Error("Not implemented in bun");
  }
}
export class MockPool {
  constructor() {
    throw new Error("Not implemented in bun");
  }
}
export class MockAgent {
  constructor() {
    throw new Error("Not implemented in bun");
  }
}

export function mockErrors() {
  throw new Error("Not implemented in bun");
}

export function Undici() {
  throw new Error("Not implemented in bun");
}

class Dispatcher extends EventEmitter {}
class Agent extends Dispatcher {}
class Pool extends Dispatcher {
  request() {
    throw new Error("Not implemented in bun");
  }
}
class BalancedPool extends Dispatcher {}
class Client extends Dispatcher {
  request() {
    throw new Error("Not implemented in bun");
  }
}

Undici.Dispatcher = Dispatcher;
Undici.Pool = Pool;
Undici.BalancedPool = BalancedPool;
Undici.Client = Client;
Undici.Agent = Agent;

Undici.buildConnector =
  Undici.errors =
  Undici.setGlobalDispatcher =
  Undici.getGlobalDispatcher =
  Undici.request =
  Undici.stream =
  Undici.pipeline =
  Undici.connect =
  Undici.upgrade =
  Undici.MockClient =
  Undici.MockPool =
  Undici.MockAgent =
  Undici.mockErrors =
    notImplemented;

Undici.fetch = fetch;

export default {
  fetch,
  Response,
  Headers,
  Request,
  URLSearchParams,
  URL,
  File,
  FileReader,
  FormData,
  request,
  stream,
  pipeline,
  connect,
  upgrade,
  MockClient,
  MockPool,
  MockAgent,
  mockErrors,
  Dispatcher,
  Pool,
  BalancedPool,
  Client,
  Agent,
  Undici,
  [Symbol.for("CommonJS")]: 0,
};
