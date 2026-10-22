// Bun.serve hands a `routes` handler a BunRequest, the host's own class below Request. --aot locks its prototype with Request.prototype: every way to change it is refused. An instance, a class of the program that extends Request and a plain Request behave as in plain Bun.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = String(work());
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  lines.push(label + ": " + text);
}

const describe = (request: Request) => [request.method, new URL(request.url).pathname, request.headers.get("x-a"), typeof request.clone, "params" in request, typeof (request as any).params].join(" ");
const cloneOf = (request: Request) => request.clone();

class Own extends Request {
  get method() {
    return "OWN";
  }
  clone() {
    return new Own(this.url + "cloned");
  }
  get params() {
    return "mine";
  }
}

let routed: Request | undefined;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/users/:id": request => {
      routed = request;
      const prototype = Object.getPrototypeOf(request);
      const paramsBefore = Object.getOwnPropertyDescriptor(prototype, "params")!;
      const cloneBefore = prototype.clone;
      say("the prototype of a routed request is Request.prototype", () => prototype === Request.prototype);
      say("the prototype above it is Request.prototype", () => Object.getPrototypeOf(prototype) === Request.prototype);
      say("own keys", () => Reflect.ownKeys(prototype).map(String).sort().join());
      say("prototype.clone = f", () => ((prototype.clone = function replaced() {}), prototype.clone === cloneBefore ? "unchanged" : "replaced"));
      try {
        prototype.clone = cloneBefore;
      } catch {}
      say("prototype.clone = the same function", () => ((prototype.clone = cloneBefore), "allowed"));
      say('Object.defineProperty(prototype, "params", getter)', () => {
        Object.defineProperty(prototype, "params", { get: () => "replaced", configurable: true });
        Object.defineProperty(prototype, "params", paramsBefore);
        return "replaced and restored";
      });
      say("prototype.params = 1", () => ((prototype.params = 1), "stored"));
      say("prototype.added = 1", () => ((prototype.added = 1), delete prototype.added, "added and deleted"));
      say("prototype.method = 1", () => ((prototype.method = 1), delete prototype.method, "added and deleted"));
      say("delete prototype.cookies", () => delete prototype.cookies);
      say("Object.setPrototypeOf(prototype, another object)", () => (Object.setPrototypeOf(prototype, {}), Object.setPrototypeOf(prototype, Request.prototype), "changed and restored"));
      say("Object.isExtensible(prototype)", () => Object.isExtensible(prototype));
      say("routed", () => describe(request));
      say("routed params", () => request.params.id);
      say("clone of routed", () => describe(cloneOf(request)) + " " + (cloneOf(request) as any).params.id);
      return new Response(request.method + " " + request.params.id + " " + request.headers.get("x-a"));
    },
  },
  fetch(request) {
    say("plain", () => describe(request));
    say("clone of plain", () => describe(cloneOf(request)));
    return new Response(request.method);
  },
});
const headers = { "x-a": "b" };
lines.push("answer: " + (await (await fetch(`http://127.0.0.1:${server.port}/users/7`, { headers })).text()));
lines.push("answer: " + (await (await fetch(`http://127.0.0.1:${server.port}/other`, { headers })).text()));
say("own", () => describe(new Own("http://a/b", { headers })));
say("clone of own", () => describe(cloneOf(new Own("http://a/b", { headers }))));
say("Own.prototype.clone = f", () => ((Own.prototype.clone = function replaced() { return new Own("http://a/replaced"); }), new URL(cloneOf(new Own("http://a/b")).url).pathname));
say("an own property on a routed request", () => (Object.defineProperty(routed!, "method", { value: "CHANGED" }), describe(routed!)));
say("another prototype for a routed request", () => (Object.setPrototypeOf(routed!, null), typeof (routed as any).url + " " + typeof (routed as any).params));
await server.stop(true);
console.log(lines.join("\n"));
