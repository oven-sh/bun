var notImplemented = function() {
  throw new Error("Not implemented in bun");
};
async function request(url, options = {
  method: "GET",
  signal: null,
  headers: null,
  query: null,
  reset: !1,
  throwOnError: !1,
  body: null
}) {
  let {
    method = "GET",
    headers: inputHeaders,
    query,
    signal,
    reset = !1,
    throwOnError = !1,
    body: inputBody,
    maxRedirections
  } = options;
  if (typeof url === "string") {
    if (query)
      url = new URL(url);
  } else if (typeof url === "object" && url !== null) {
    if (!(url instanceof URL))
      throw new Error("not implemented");
  } else
    throw new TypeError("url must be a string, URL, or UrlObject");
  if (typeof url === "string" && query)
    url = new URL(url);
  if (typeof url === "object" && url !== null && query) {
    if (query)
      url.search = new URLSearchParams(query).toString();
  }
  if (method = method && typeof method === "string" ? method.toUpperCase() : null, inputBody && (method === "GET" || method === "HEAD"))
    throw new Error("Body not allowed for GET or HEAD requests");
  if (inputBody && inputBody.read && inputBody instanceof Readable) {
    let data = "";
    inputBody.setEncoding("utf8");
    for await (let chunk of stream)
      data += chunk;
    inputBody = (new TextEncoder()).encode(data);
  }
  if (maxRedirections !== void 0 && Number.isNaN(maxRedirections))
    throw new Error("maxRedirections must be a number if defined");
  if (signal && !(signal instanceof AbortSignal))
    throw new Error("signal must be an instance of AbortSignal");
  let resp;
  const {
    status: statusCode,
    headers,
    trailers
  } = resp = await fetch(url, {
    signal,
    mode: "cors",
    method,
    headers: inputHeaders || kEmptyObject,
    body: inputBody,
    redirect: maxRedirections === "undefined" || maxRedirections > 0 ? "follow" : "manual",
    keepalive: !reset
  });
  if (throwOnError && statusCode >= 400 && statusCode < 600)
    throw new Error(`Request failed with status code ${statusCode}`);
  const body = resp.body ? new BodyReadable(resp) : null;
  return { statusCode, headers, body, trailers, opaque: kEmptyObject, context: kEmptyObject };
}
function stream() {
  throw new Error("Not implemented in bun");
}
function pipeline() {
  throw new Error("Not implemented in bun");
}
function connect() {
  throw new Error("Not implemented in bun");
}
function upgrade() {
  throw new Error("Not implemented in bun");
}
function mockErrors() {
  throw new Error("Not implemented in bun");
}
function Undici() {
  throw new Error("Not implemented in bun");
}
var { EventEmitter } = import.meta.require("events"), {
  Readable,
  [Symbol.for("::bunternal::")]: { _ReadableFromWeb }
} = import.meta.require("node:stream"), ObjectCreate = Object.create, kEmptyObject = ObjectCreate(null), fetch = Bun.fetch, Response = globalThis.Response, Headers = globalThis.Headers, Request = globalThis.Request, URLSearchParams = globalThis.URLSearchParams, URL = globalThis.URL;

class File extends Blob {
}

class FileReader extends EventTarget {
  constructor() {
    throw new Error("Not implemented yet!");
  }
}
var FormData = globalThis.FormData;

class BodyReadable extends _ReadableFromWeb {
  #response;
  #bodyUsed;
  constructor(response, options = {}) {
    var { body } = response;
    if (!body)
      throw new Error("Response body is null");
    super(options, body);
    this.#response = response, this.#bodyUsed = response.bodyUsed;
  }
  get bodyUsed() {
    return this.#bodyUsed;
  }
  #consume() {
    if (this.#bodyUsed)
      throw new TypeError("unusable");
    this.#bodyUsed = !0;
  }
  async arrayBuffer() {
    return this.#consume(), await this.#response.arrayBuffer();
  }
  async blob() {
    return this.#consume(), await this.#response.blob();
  }
  async formData() {
    return this.#consume(), await this.#response.formData();
  }
  async json() {
    return this.#consume(), await this.#response.json();
  }
  async text() {
    return this.#consume(), await this.#response.text();
  }
}

class MockClient {
  constructor() {
    throw new Error("Not implemented in bun");
  }
}

class MockPool {
  constructor() {
    throw new Error("Not implemented in bun");
  }
}

class MockAgent {
  constructor() {
    throw new Error("Not implemented in bun");
  }
}

class Dispatcher extends EventEmitter {
}

class Agent extends Dispatcher {
}

class Pool extends Dispatcher {
  request() {
    throw new Error("Not implemented in bun");
  }
}

class BalancedPool extends Dispatcher {
}

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
Undici.buildConnector = Undici.errors = Undici.setGlobalDispatcher = Undici.getGlobalDispatcher = Undici.request = Undici.stream = Undici.pipeline = Undici.connect = Undici.upgrade = Undici.MockClient = Undici.MockPool = Undici.MockAgent = Undici.mockErrors = notImplemented;
Undici.fetch = fetch;
var undici_default = {
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
  [Symbol.for("CommonJS")]: 0
};
export {
  upgrade,
  stream,
  request,
  pipeline,
  mockErrors,
  fetch,
  undici_default as default,
  connect,
  Undici,
  URLSearchParams,
  URL,
  Response,
  Request,
  MockPool,
  MockClient,
  MockAgent,
  Headers,
  FormData,
  FileReader,
  File
};

//# debugId=5D37E8AC1A29144964756e2164756e21
