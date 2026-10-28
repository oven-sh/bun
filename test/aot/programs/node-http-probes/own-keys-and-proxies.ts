// The own keys of a request, a response and their socket are listed, copied and described, and Proxies of the three are used in their place.
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

function describeKeys(object: object): string {
  const keys = Reflect.ownKeys(object).map(key => {
    const descriptor = Reflect.getOwnPropertyDescriptor(object, key)!;
    return `${String(key)}${descriptor.enumerable ? "" : " (hidden)"}`;
  });
  return keys.join(" ");
}

function report(label: string, object: object) {
  console.log(label, "own:", describeKeys(object));
  console.log(label, "spread:", describeKeys({ ...object }));
  console.log(label, "assigned:", describeKeys(Object.assign({}, object)));
  console.log(label, "symbols:", Object.getOwnPropertySymbols(object).length, "names:", Object.keys(object).length);
}

const handlers: http.RequestListener[] = [
  (request, response) => {
    report("request", request);
    report("response", response);
    report("socket", request.socket);
    response.end("listed");
  },
  (_request, response) => {
    const trapped: string[] = [];
    const proxy = new Proxy(response, {
      get(target, key, receiver) {
        trapped.push(`get ${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
      set(target, key, value, receiver) {
        trapped.push(`set ${String(key)}`);
        return Reflect.set(target, key, value, receiver);
      },
    });
    proxy.statusCode = 201;
    proxy.setHeader("x-a", "1");
    proxy.write("a");
    proxy.end("b");
    console.log(trapped.join(", "));
  },
  (_request, response) => void new Proxy(new Proxy(response, {}), {}).end("twice"),
  (request, response) => {
    const proxy = new Proxy(request, {});
    let body = "";
    proxy.setEncoding("utf8");
    proxy.on("data", chunk => (body += chunk));
    proxy.on("end", () => response.end(`${proxy.method} ${body}`));
  },
  (request, response) => {
    const proxy = new Proxy(request.socket, {});
    proxy.setTimeout(60_000);
    const armed = proxy.timeout;
    proxy.setTimeout(0);
    response.end(`${armed} ${proxy.timeout}`);
  },
  (_request, response) => void Object.create(response).end("inherited"),
  (_request, response) => {
    const { proxy, revoke } = Proxy.revocable(response, {});
    const end = proxy.end;
    revoke();
    try {
      Reflect.apply(end, proxy, ["never"]);
    } catch (error) {
      console.log((error as Error).name);
    }
    response.end("revoked");
  },
];

let turn = 0;
const server = http.createServer((request, response) => handlers[turn++](request, response));
await once(server.listen(0, "127.0.0.1"), "listening");
const { port } = server.address() as AddressInfo;
for (let i = 0; i < handlers.length; i++) {
  const response = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: "hi" });
  console.log(response.status, response.headers.get("x-a"), await response.text());
}
server.close();
