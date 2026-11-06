const { getOwnPropertyDescriptor, getPrototypeOf } = Object;
const { ownKeys } = Reflect;

const isWellKnownSymbol = key => Symbol[String(key.description).slice(7)] === key;

function printedNameOf(key) {
  if (typeof key !== "symbol") return key;
  const registeredKey = Symbol.keyFor(key);
  if (registeredKey !== undefined) return "@@@" + registeredKey;
  return isWellKnownSymbol(key) ? "@@" + key.description.slice(7) : "@@?" + String(key.description);
}

const asyncGeneratorPrototype = getPrototypeOf(async function* () {}).prototype;

async function findPrototypeOfRoutedRequests() {
  let prototype = null;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/": request => {
        prototype = getPrototypeOf(request);
        return new Response();
      },
    },
  });
  await fetch(server.url);
  await server.stop(true);
  return prototype;
}

// The native object behind a ServerResponse has no name: the library keeps it under a symbol of its own.
async function findPrototypeOfNativeResponses() {
  const http = await import("node:http");
  let prototype = null;
  const server = http.createServer((request, response) => {
    const key = Object.getOwnPropertySymbols(response).find(symbol => symbol.description === "handle");
    prototype = getPrototypeOf(response[key]);
    response.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  await fetch(`http://127.0.0.1:${server.address().port}/`);
  await new Promise(resolve => server.close(resolve));
  return prototype;
}

async function findPrototypeOfServerWebSockets() {
  const { promise, resolve } = Promise.withResolvers();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      server.upgrade(request);
    },
    websocket: {
      open(socket) {
        resolve(getPrototypeOf(socket));
      },
      message() {},
    },
  });
  const client = new WebSocket(`ws://127.0.0.1:${server.port}/`);
  const prototype = await promise;
  client.close();
  await server.stop(true);
  return prototype;
}

const hiddenObjects = new Map([
  ["%ArrayIterator%.prototype", getPrototypeOf([][Symbol.iterator]())],
  ["%AsyncFunction%.prototype", getPrototypeOf(async function () {})],
  ["%AsyncGenerator%.prototype", asyncGeneratorPrototype],
  ["%AsyncGeneratorFunction%.prototype", getPrototypeOf(async function* () {})],
  ["%AsyncIterator%.prototype", getPrototypeOf(asyncGeneratorPrototype)],
  ["%BunRequest%.prototype", await findPrototypeOfRoutedRequests()],
  ["%EventEmitter%.prototype", getPrototypeOf(process)],
  ["%Generator%.prototype", getPrototypeOf(function* () {}).prototype],
  ["%GeneratorFunction%.prototype", getPrototypeOf(function* () {})],
  ["%HeadersIterator%.prototype", getPrototypeOf(new Headers()[Symbol.iterator]())],
  ["%IteratorHelper%.prototype", getPrototypeOf([].values().map(x => x))],
  ["%MapIterator%.prototype", getPrototypeOf(new Map()[Symbol.iterator]())],
  ["%NodeHTTPResponse%.prototype", await findPrototypeOfNativeResponses()],
  ["%RegExpStringIterator%.prototype", getPrototypeOf("".matchAll(/(?:)/g))],
  ["%S3File%.prototype", getPrototypeOf(Bun.file("s3://bucket/key"))],
  ["%ServerWebSocket%.prototype", await findPrototypeOfServerWebSockets()],
  ["%SetIterator%.prototype", getPrototypeOf(new Set()[Symbol.iterator]())],
  ["%StringIterator%.prototype", getPrototypeOf(""[Symbol.iterator]())],
  ["%TypedArray%", getPrototypeOf(Uint8Array)],
  ["%URLSearchParamsIterator%.prototype", getPrototypeOf(new URLSearchParams()[Symbol.iterator]())],
  ["%WrapForValidIterator%.prototype", getPrototypeOf(Iterator.from({ next() {} }))],
]);

function getStep(object, name) {
  const descriptor = getOwnPropertyDescriptor(object, name);
  if (descriptor === undefined) return null;
  const value = "get" in descriptor ? descriptor.get?.call(object) : descriptor.value;
  return typeof value === "function" || (typeof value === "object" && value !== null) ? value : null;
}

function find(path) {
  if (path === "globalThis") return globalThis;
  const hidden = hiddenObjects.get(path);
  if (hidden !== undefined) return hidden;
  const [first, ...rest] = path.split(".");
  let object = hiddenObjects.get(first) ?? getStep(globalThis, first);
  for (const part of rest) {
    if (object === null) return null;
    object = getStep(object, part);
  }
  return object;
}

function attributesOf(descriptor) {
  const kind = "get" in descriptor ? "a" : descriptor.writable ? "w" : "";
  return kind + (descriptor.configurable ? "c" : "") || "-";
}

function describeOwnProperties(object) {
  if (object === null) return null;
  return Object.fromEntries(
    ownKeys(object).map(key => [printedNameOf(key), attributesOf(getOwnPropertyDescriptor(object, key))]),
  );
}

const paths = process.argv.slice(2);
console.log(JSON.stringify(Object.fromEntries(paths.map(path => [path, describeOwnProperties(find(path))]))));
