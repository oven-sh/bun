// `request.headers.get(name)` and `request.headers.has(name)` on every kind of request, before and after everything a program can do to a request or to its headers: each gives what plain Bun gives.
import { connect } from "node:net";
import type { BunRequest } from "bun";

const lines: string[] = [];
function attempt(work: () => unknown): unknown {
  try {
    return work();
  } catch (error) {
    return "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
}

function readsOne(request: Request) {
  return request.headers.get("x-one");
}
function asksForOne(request: Request) {
  return request.headers.has("x-one");
}
function readsByVariable(request: Request, name: string) {
  return request.headers.get(name);
}
export function readsOfAnything(request: any) {
  return request.headers.get("x-one");
}
function readsMany(request: Request) {
  return [
    request.headers.get("x-one"),
    request.headers.get("X-One"),
    request.headers.get("X-ONE"),
    request.headers.get("x-two"),
    request.headers.get("x-empty"),
    request.headers.get("x-absent"),
    request.headers.get("x-dup"),
    request.headers.get("cookie"),
    request.headers.get("accept"),
    request.headers.get("Content-Type"),
    request.headers.get("host") === null,
    request.headers.get("x-latin"),
    request.headers.get("x-spaces"),
    request.headers.has("x-one"),
    request.headers.has("X-Two"),
    request.headers.has("x-empty"),
    request.headers.has("x-absent"),
    request.headers.has("x-dup"),
    request.headers.has("content-type"),
  ];
}
function invalidNames(request: Request) {
  return [
    attempt(() => request.headers.get("bad name")),
    attempt(() => request.headers.get("")),
    attempt(() => request.headers.get("x:y")),
    attempt(() => request.headers.get("café")),
    attempt(() => request.headers.get("中")),
    attempt(() => request.headers.has("bad name")),
    attempt(() => request.headers.has("")),
  ];
}
function readsOfRoute(request: BunRequest<"/route/:id">) {
  return [request.params.id, request.headers.get("x-one"), request.headers.has("x-two"), request.headers.get("x-absent")];
}

class Subclass extends Request {
  get headers() {
    return new Headers({ "x-one": "of the subclass" });
  }
}
class PlainSubclass extends Request {}

const handlers: Record<string, (request: Request) => unknown> = {
  "/many": readsMany,
  "/one": request => [readsOne(request), asksForOne(request), readsByVariable(request, "x-one"), readsOfAnything(request)],
  "/invalid": invalidNames,
  "/invalid-after-the-object-is-made": request => [typeof request.headers, invalidNames(request)],
  "/twice": request => [readsOne(request), readsOne(request), readsMany(request).join() === readsMany(request).join()],
  "/then-the-object": request => {
    const before = readsOne(request);
    const headers = request.headers;
    return [before, headers.get("x-one"), readsOne(request), headers === request.headers, [...headers.keys()].filter(key => key.startsWith("x-")).join()];
  },
  "/after-await": async request => {
    const before = readsOne(request);
    await Promise.resolve();
    const soon = readsMany(request);
    await new Promise(resolve => setTimeout(resolve, 2));
    return [before, soon, readsMany(request)];
  },
  "/only-after-await": async request => {
    await new Promise(resolve => setTimeout(resolve, 2));
    return readsMany(request);
  },
  "/after-the-body": async request => [await request.text(), readsMany(request)],
  "/set": request => {
    const before = readsOne(request);
    request.headers.set("x-one", "set");
    request.headers.set("x-added", "added");
    return [before, readsOne(request), request.headers.get("x-added"), request.headers.has("x-added")];
  },
  "/delete": request => {
    request.headers.delete("x-one");
    return [readsOne(request), asksForOne(request)];
  },
  "/append": request => {
    request.headers.append("x-one", "more");
    return [readsOne(request), asksForOne(request)];
  },
  "/own-get-on-the-headers": request => {
    const before = readsOne(request);
    (request.headers as unknown as Record<string, unknown>).get = () => "own get";
    (request.headers as unknown as Record<string, unknown>).has = () => false;
    return [before, readsOne(request), asksForOne(request)];
  },
  "/own-other-property-on-the-headers": request => {
    (request.headers as unknown as Record<string, unknown>).note = 1;
    return [readsOne(request), asksForOne(request)];
  },
  "/prototype-of-the-headers": request => {
    Object.setPrototypeOf(request.headers, { get: () => "another prototype", has: () => false });
    return [readsOne(request), asksForOne(request)];
  },
  "/own-headers-on-the-request": request => {
    const before = readsOne(request);
    Object.defineProperty(request, "headers", { value: new Headers({ "x-one": "own headers" }), configurable: true });
    const shadowed = [readsOne(request), asksForOne(request)];
    delete (request as unknown as Record<string, unknown>).headers;
    return [before, shadowed, readsOne(request)];
  },
  "/own-other-property-on-the-request": request => {
    (request as unknown as Record<string, unknown>).note = 1;
    return [readsOne(request), asksForOne(request)];
  },
  "/prototype-of-the-request": request => {
    Object.setPrototypeOf(request, Object.create(Request.prototype, { headers: { value: new Headers({ "x-one": "another prototype" }) } }));
    return [readsOne(request), asksForOne(request)];
  },
  "/clone": request => {
    const before = readsOne(request);
    const clone = request.clone();
    return [before, readsOne(clone), readsMany(clone).join() === readsMany(request).join()];
  },
  "/clone-first": request => {
    const clone = request.clone();
    clone.headers.set("x-one", "of the clone");
    return [readsOne(clone), readsOne(request)];
  },
  "/made-from-it": request => {
    const made = new Request(request);
    const changed = new Request(request, { headers: { "x-one": "changed" } });
    return [readsOne(made), readsOne(changed), readsOne(request), changed.headers.get("x-two")];
  },
  "/subclass-made-from-it": request => [readsOne(new Subclass(request)), asksForOne(new Subclass(request)), readsOne(new PlainSubclass(request)), asksForOne(new PlainSubclass(request))],
};

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/route/:id": request => Response.json(readsOfRoute(request)),
  },
  async fetch(request) {
    const handler = handlers[new URL(request.url).pathname];
    return Response.json(await handler(request));
  },
});

function send(path: string, headerLines: string[], body = ""): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(server.port!, "127.0.0.1", () => {
      const head = [`${body ? "POST" : "GET"} ${path} HTTP/1.1`, "Host: 127.0.0.1", "Connection: close", ...headerLines];
      if (body) head.push("Content-Length: " + Buffer.byteLength(body));
      socket.write(Buffer.from(head.join("\r\n") + "\r\n\r\n" + body, "latin1"));
    });
    const chunks: Buffer[] = [];
    socket.on("data", chunk => chunks.push(chunk as Buffer));
    socket.on("error", reject);
    socket.on("close", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve(text.slice(text.indexOf("\r\n\r\n") + 4));
    });
  });
}

const usual = [
  "X-One: 1",
  "x-two: two words",
  "X-Empty:",
  "x-dup: a",
  "X-Dup: b",
  "Cookie: a=1",
  "Cookie: b=2",
  "Accept: text/html",
  "Accept: application/json",
  "Content-Type: text/plain",
  "X-Latin: café",
  "X-Spaces:    padded   ",
];
for (const path of Object.keys(handlers)) {
  lines.push(path + ": " + (await send(path, usual, path === "/after-the-body" ? "the body" : "")));
  lines.push(path + ", no headers: " + (await send(path, [], path === "/after-the-body" ? "the body" : "")));
}
lines.push("/route/7: " + (await send("/route/7", usual)));
lines.push("/route/8, no headers: " + (await send("/route/8", [])));
server.stop(true);

const made: [string, () => Request][] = [
  ["no init", () => new Request("http://localhost/")],
  ["a record", () => new Request("http://localhost/", { headers: { "X-One": "record", "x-two": "2" } })],
  ["pairs with a repeated name", () => new Request("http://localhost/", { headers: [["x-one", "a"], ["X-One", "b"]] })],
  ["a Headers object", () => new Request("http://localhost/", { headers: new Headers({ "x-one": "object" }) })],
  ["a body with a type", () => new Request("http://localhost/", { method: "POST", body: new Blob(["x"], { type: "a/b" }) })],
  ["a string body", () => new Request("http://localhost/", { method: "POST", body: "text" })],
  ["a form body", () => new Request("http://localhost/", { method: "POST", body: new URLSearchParams({ a: "1" }) })],
  ["a subclass with its own getter", () => new Subclass("http://localhost/", { headers: { "x-one": "ignored" } })],
  ["a subclass without members", () => new PlainSubclass("http://localhost/", { headers: { "x-one": "plain subclass" } })],
];
for (const [label, make] of made) {
  lines.push(label + ": " + JSON.stringify([readsOne(make()), asksForOne(make()), make().headers.get("content-type"), make().headers.has("content-type"), invalidNames(make()).length]));
  const request = make();
  lines.push(label + ", read again: " + JSON.stringify([readsOne(request), readsOne(request), request.headers.get("content-type"), typeof request.headers, readsOne(request)]));
}
lines.push("not a request at all: " + JSON.stringify(attempt(() => readsOne({ headers: { get: (name: string) => "a look-alike: " + name } } as unknown as Request))));
lines.push("null: " + String(attempt(() => readsOne(null as unknown as Request))).split(":")[0]);
lines.push("a Response in its place: " + JSON.stringify(attempt(() => readsOne(new Response("", { headers: { "x-one": "of a response" } }) as unknown as Request))));

console.log(lines.join("\n"));
