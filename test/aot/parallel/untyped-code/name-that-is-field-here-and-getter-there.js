// `request.headers`, `response.ended`: one name that some of the objects keep in a field and others compute in a getter, read in functions that anybody may call, so that nothing is known of
// what arrives. Beside the read the functions use other objects, whose own reads must not suffer from which of the two arrives. Every kind of stranger arrives too.
const lines = [];
function show(name, run) {
  const seen = [];
  for (let turn = 0; turn < 4; turn++) {
    try {
      seen.push(String(JSON.stringify(run(turn)) ?? "undefined"));
    } catch (error) {
      seen.push(error.constructor.name + (error instanceof RangeError ? ": " + error.message : ""));
    }
  }
  lines.push(name + ": " + seen.join(" | "));
}
const log = [];
class Incoming {
  constructor(url) { this.url = url; this.socket = { remote: "10.0.0." + url.length }; this.made = 0; }
  get headers() { log.push("headers of " + this.url); this.made++; return { host: "incoming", connection: this.made % 2 ? "keep-alive" : "" }; }
  get aborted() { return false; }
}
class Upgraded extends Incoming {
  get headers() { return { host: "upgraded", connection: "upgrade", below: super.headers.host }; }
}
function StandIn(url) { this.url = url; this.headers = { host: "stand-in", connection: "close" }; this.socket = { remote: "local" }; this.aborted = true; }
class Throwing { constructor() { this.url = "/throws"; this.socket = null; } get headers() { throw new RangeError("no headers"); } }
function Context(limit) { this.limit = limit; this.onRequest = null; this.name = "context " + limit; }

const handlers = {
  route(request, context) {
    const connection = String(request.headers.connection || "none");
    const limit = context.limit;
    return [connection, limit, context.onRequest, context.name, request.url, request.socket && request.socket.remote];
  },
  twice(request, context) { return [request.headers.host, context.limit, request.headers.host, context.name]; },
  flags(request) { return [request.aborted, request.url]; },
  inLoop(requests, context) { let all = ""; for (const request of requests) all += request.headers.host + context.limit + ";"; return all; },
  conditional(request, context, wanted) { return wanted ? [request.headers.host, context.name] : [context.name, request.url]; },
};
globalThis.handlersForAnybody = handlers;
const call = (name, ...all) => globalThis.handlersForAnybody[name](...all);

const requests = {
  "the class with the getter": () => new Incoming("/a"),
  "the function with the field": () => new StandIn("/b"),
  "a class below the class": () => new Upgraded("/c"),
  "a literal": () => ({ url: "/d", headers: { host: "literal" }, socket: null, aborted: 0 }),
  "a literal with a getter": () => ({ url: "/e", get headers() { return { host: "own getter" }; }, socket: undefined }),
  "an object above which the class stands": () => Object.create(new Incoming("/f")),
  "an instance with its own property over the getter": () => Object.defineProperty(new Incoming("/g"), "headers", { value: { host: "own value" } }),
  "an instance with more properties": () => Object.assign(new Incoming("/h"), { extra: 1 }),
  "a frozen stand-in": () => Object.freeze(new StandIn("/i")),
  "a stand-in whose field was deleted": () => { const s = new StandIn("/j"); delete s.headers; return s; },
  "a stand-in under another prototype": () => Object.setPrototypeOf(new StandIn("/k"), { get headers() { return { host: "never: the field is there" }; } }),
  "a proxy": () => new Proxy(new StandIn("/l"), { get: (target, key) => (key === "headers" ? { host: "trap" } : target[key]) }),
  "a getter that throws": () => new Throwing(),
  "a string": () => "text",
  "a number": () => 7,
  null: () => null,
  undefined: () => undefined,
};
for (const [name, request] of Object.entries(requests)) {
  show("route: " + name, turn => call("route", request(turn), new Context(turn)));
  show("twice: " + name, turn => call("twice", request(turn), new Context(turn)));
  show("flags: " + name, turn => call("flags", request(turn)));
  show("conditional: " + name, turn => call("conditional", request(turn), new Context(turn), turn % 2 === 0));
}
show("the context is a stranger", turn => call("route", turn % 2 ? new Incoming("/m") : new StandIn("/n"), { limit: "other", name: "a literal", onRequest: undefined }));
show("both in one loop", turn => call("inLoop", [new Incoming("/o"), new StandIn("/p"), new Upgraded("/q"), { headers: { host: "x" } }, new Incoming("/r")], new Context(turn)));
show("the getter runs once a read, in order", () => { log.length = 0; call("twice", new Incoming("/s"), new Context(0)); call("route", new Incoming("/t"), new Context(0)); return log.slice(); });
show("the same object again and again", () => { const one = new Incoming("/u"); return [call("route", one, new Context(1))[0], call("route", one, new Context(2))[0], call("route", one, new Context(3))[0], one.made]; });

const before = call("route", new Incoming("/v"), new Context(9));
Object.defineProperty(Incoming.prototype, "headers", { configurable: true, get() { return { host: "replaced", connection: "replaced" }; } });
show("the getter of the class is replaced", turn => [before[0], call("route", new Incoming("/w"), new Context(turn)), call("twice", new Upgraded("/x"), new Context(turn)), call("route", new StandIn("/y"), new Context(turn))]);
delete Incoming.prototype.headers;
show("the getter of the class is gone", turn => call("route", new Incoming("/z"), new Context(turn)));
Incoming.prototype.headers = { host: "a value on the prototype", connection: "value" };
show("a value stands in its place", turn => [call("route", new Incoming("/0"), new Context(turn)), call("route", new StandIn("/1"), new Context(turn))]);
console.log(lines.join("\n"));
