const { EventEmitter } = import.meta.require("events");

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

export class FormData {
  constructor() {
    throw new Error("Not implemented yet!");
  }
}
function notImplemented() {
  throw new Error("Not implemented in bun");
}
export function request() {
  throw new Error("TODO: Not implemented in bun yet!");
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
class Pool extends Dispatcher {}
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
