// A class that extends ServerResponse has an accessor under every name its constructor stores. What the setters are handed while a response is constructed is printed.
import { once } from "node:events";
import http from "node:http";

const names = [
  "_events",
  "_eventsCount",
  "_maxListeners",
  "outputData",
  "outputSize",
  "writable",
  "destroyed",
  "_last",
  "chunkedEncoding",
  "shouldKeepAlive",
  "maxRequestsOnConnectionReached",
  "_defaultKeepAlive",
  "useChunkedEncodingByDefault",
  "sendDate",
  "_removedConnection",
  "_removedContLen",
  "_removedTE",
  "strictContentLength",
  "_contentLength",
  "_hasBody",
  "_trailer",
  "finished",
  "_headerSent",
  "_closed",
  "_header",
  "_keepAliveTimeout",
  "_onPendingData",
  "req",
  "_sent100",
  "statusCode",
  "statusMessage",
  "_maxRequestsPerSocket",
];

function show(value: unknown): string {
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return `array of ${value.length}`;
  if (typeof value === "object" && value !== null)
    return Object.getPrototypeOf(value) === null ? "object without a prototype" : value.constructor.name;
  return String(value);
}

let stores: string[] | undefined;
function withAccessors<T extends new (...args: any[]) => object>(Base: T): T {
  const Heir = class extends Base {
    constructor(...args: any[]) {
      stores = [];
      super(...args);
      console.log(stores.join(" | "));
      console.log("own:", Reflect.ownKeys(this).map(String).join(" "));
      stores = undefined;
    }
  };
  for (const name of names) {
    const values = new WeakMap<object, unknown>();
    Object.defineProperty(Heir.prototype, name, {
      configurable: true,
      get() {
        return values.get(this);
      },
      set(value) {
        stores?.push(`${name} = ${show(value)}`);
        values.set(this, value);
      },
    });
  }
  return Heir;
}

const Response = withAccessors(http.ServerResponse);
for (const [method, version] of [
  ["GET", "1.1"],
  ["HEAD", "1.1"],
  ["GET", "1.0"],
]) {
  console.log(`new, ${method} HTTP/${version}`);
  const [major, minor] = version.split(".").map(Number);
  new Response({ method, httpVersionMajor: major, httpVersionMinor: minor, headers: {} } as any);
}

console.log("called as a function");
function Called(this: any, req: any) {
  stores = [];
  http.ServerResponse.call(this, req);
  console.log(stores.join(" | "));
  stores = undefined;
}
Object.setPrototypeOf(Called.prototype, Response.prototype);
new (Called as any)({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1, headers: {} });

console.log("of a server");
class Kept extends http.ServerResponse {
  // @ts-ignore
  set shouldKeepAlive(value: boolean) {
    console.log("shouldKeepAlive =", value);
    Reflect.set(http.ServerResponse.prototype, "shouldKeepAlive", value, this);
  }
  // @ts-ignore
  get shouldKeepAlive() {
    return Reflect.get(http.ServerResponse.prototype, "shouldKeepAlive", this);
  }
  // @ts-ignore
  set sendDate(value: boolean) {
    console.log("sendDate =", value);
    Object.defineProperty(this, "sendDate", { value, writable: true, enumerable: true, configurable: true });
  }
  // @ts-ignore
  set chunkedEncoding(value: boolean) {
    console.log("chunkedEncoding =", value);
    Reflect.set(http.ServerResponse.prototype, "chunkedEncoding", value, this);
  }
  // @ts-ignore
  set writable(value: boolean) {
    console.log("writable =", value);
  }
}
const server = http.createServer({ ServerResponse: Kept }, (_req, res) => void res.end("ok"));
await once(server.listen(0, "127.0.0.1"), "listening");
const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/`);
console.log(response.status, await response.text(), response.headers.has("date"), response.headers.get("connection"));
server.close();
server.closeAllConnections();
