// `request.headers.get(name)` on the requests of a server, with and without a route, and on everything that only looks like one.
const constantName = (request: Request) => request.headers.get("x-a");
const givenName = (request: Request, name: string) => request.headers.get(name);
const anyName = (request: Request, name: unknown) => request.headers.get(name as any);
const ofResponse = (response: Response) => response.headers.get("x-a");
const ofAnything = (holder: { headers: { get(name: string): unknown } }) => holder.headers.get("x-a");

function attempt(run: () => unknown) {
  try {
    return run();
  } catch (error) {
    return `${(error as Error).name}: ${(error as Error).message}`;
  }
}

const nameOfError = (run: () => unknown) => String(attempt(run)).split(":")[0];

function rowsOf(request: Request) {
  const log: string[] = [];
  const rows: unknown[] = [
    constantName(request),
    givenName(request, "X-A"),
    givenName(request, "x-absent"),
    givenName(request, "x-empty"),
    givenName(request, "x-latin"),
    givenName(request, "x-twice"),
    givenName(request, "cookie"),
    givenName(request, "set-cookie"),
    givenName(request, "host") !== null,
    givenName(request, "content-type"),
    attempt(() => givenName(request, "")),
    attempt(() => givenName(request, "a b")),
    attempt(() => givenName(request, "café")),
    attempt(() => givenName(request, "世")),
    attempt(() => anyName(request, 1)),
    attempt(() => anyName(request, undefined)),
    attempt(() => anyName(request, null)),
    attempt(() => anyName(request, Symbol("x-a"))),
    attempt(() => anyName(request, { toString: () => (log.push("converted"), "x-a") })),
    attempt(() => anyName(request, { toString: () => (request.headers.set("x-a", "set while the name was converted"), "x-a") })),
    attempt(() =>
      anyName(request, {
        toString() {
          throw new RangeError("thrown by the name");
        },
      }),
    ),
    log,
  ];
  return rows;
}

function afterwards(request: Request) {
  const headers = request.headers;
  const rows: unknown[] = [headers === request.headers, constantName(request)];
  headers.set("x-a", "changed");
  rows.push(constantName(request), givenName(request, "x-a"));
  headers.delete("x-a");
  rows.push(constantName(request));
  headers.append("x-a", "one");
  headers.append("x-a", "two");
  rows.push(constantName(request), request.clone().headers.get("x-a"), [...headers.keys()].includes("x-twice"));
  return rows;
}

const untouched = (request: Request) => Response.json([constantName(request), givenName(request, "x-twice"), [...request.headers].filter(([name]) => name.startsWith("x-"))]);
const first = (request: Request) => Response.json([rowsOf(request), afterwards(request)]);
const later = async (request: Request) => {
  const before = constantName(request);
  await Bun.sleep(1);
  return Response.json([before, rowsOf(request), afterwards(request)]);
};
const onlyLater = async (request: Request) => {
  await Bun.sleep(1);
  return Response.json([constantName(request), givenName(request, "x-twice"), givenName(request, "x-absent")]);
};

const server = Bun.serve({
  port: 0,
  routes: { "/static": new Response("static"), "/routed/untouched": untouched, "/routed/first": first, "/routed/later": later, "/routed/only-later": onlyLater },
  fetch(request) {
    const path = new URL(request.url).pathname;
    return path === "/untouched" ? untouched(request) : path === "/first" ? first(request) : path === "/later" ? later(request) : path === "/only-later" ? onlyLater(request) : new Response("none", { status: 404 });
  },
});

function send(path: string): Promise<string> {
  const lines = [`GET ${path} HTTP/1.1`, "Host: localhost", "x-a: 1", "X-Empty:", "x-latin: café", "x-twice: a", "X-Twice: b", "Cookie: a=1", "Cookie: b=2", "Set-Cookie: c=3", "Set-Cookie: d=4", "Connection: close", "", ""];
  return new Promise((resolve, reject) => {
    let received = "";
    Bun.connect({
      hostname: "127.0.0.1",
      port: server.port!,
      socket: {
        open: (socket) => void socket.write(Buffer.from(lines.join("\r\n"), "latin1")),
        data: (_, chunk) => void (received += chunk.toString("utf8")),
        close: () => resolve(received.slice(received.indexOf("\r\n\r\n") + 4)),
        error: (_, error) => reject(error),
      },
    }).catch(reject);
  });
}

for (const path of ["/untouched", "/first", "/later", "/only-later", "/routed/untouched", "/routed/first", "/routed/later", "/routed/only-later"]) console.log(path, await send(path));
await server.stop(true);

class Subclass extends Request {}
class Overriding extends Request {
  get headers() {
    return new Headers({ "x-a": "overridden" });
  }
}
const made = (init?: RequestInit) => new Request("http://localhost/", init);
const withOwn = made({ headers: { "x-a": "hidden" } });
Object.defineProperty(withOwn, "headers", { value: { get: (name: string) => `own ${name}` } });
console.log(
  JSON.stringify([
    constantName(made({ headers: { "x-a": "made" } })),
    constantName(made()),
    givenName(made({ method: "POST", body: new Blob(["x"], { type: "text/x-made" }) }), "content-type"),
    givenName(made({ method: "POST", body: "text" }), "content-type"),
    constantName(new Subclass("http://localhost/", { headers: { "x-a": "subclass" } })),
    constantName(new Overriding("http://localhost/")),
    constantName(withOwn),
    ofResponse(new Response("", { headers: { "x-a": "response" } })),
    ofAnything({ headers: new Map([["x-a", "map"]]) }),
    ofAnything({ headers: new Headers({ "x-a": "headers" }) }),
    nameOfError(() => constantName(null as unknown as Request)),
    nameOfError(() => constantName({} as Request)),
    rowsOf(made({ headers: { "x-a": "made", "x-empty": "", "x-twice": "a" } })),
    afterwards(made({ headers: { "x-a": "made", "x-twice": "a" } })),
  ]),
);
let total = 0;
for (let i = 0; i < 3000; i++) {
  total += constantName(made({ headers: { "x-a": "v" + i } }))!.length + (givenName(made(), "x-a") === null ? 1 : 0);
  if (i % 1000 === 0) Bun.gc(true);
}
console.log("many", total);
