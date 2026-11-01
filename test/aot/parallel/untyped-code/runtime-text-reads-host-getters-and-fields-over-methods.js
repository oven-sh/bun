// Text made at run time reads getters of host classes, names that are a field on some objects of a class and a method on the others, and makes empty lists.
const make = (parameters, body) => new Function(...parameters, body + process.argv.slice(99).join(""));
const lines = [];
const say = (...parts) => lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));

// Getters of host classes: first read, second read, a receiver that is none of the class, a getter that throws.
const readRequest = make(["r"], "return [r.url, r.method, r.headers.get('x-a'), r.url, r.method, r.bodyUsed, r.keepalive]");
for (let turn = 0; turn < 300; turn++) {
  const request = new Request("http://localhost/p/" + (turn & 3), { method: turn & 1 ? "POST" : "GET", headers: { "x-a": "v" + (turn & 7) }, body: turn & 1 ? "b" : undefined });
  const answer = readRequest(request);
  if (turn % 97 === 0) say("request", answer);
}
const readUrl = make(["r"], "return r.url");
for (let turn = 0; turn < 300; turn++) {
  const receiver = turn % 50 === 49 ? Object.create(Request.prototype) : turn % 50 === 48 ? { url: "own " + turn } : new Request("http://localhost/q" + (turn % 3));
  let answer;
  try {
    answer = readUrl(receiver);
  } catch (error) {
    answer = error.constructor.name;
  }
  if (turn % 50 >= 47) say("url", turn, answer);
}
const readResponse = make(["r"], "return [r.status, r.ok, r.statusText, r.headers === r.headers, r.type, r.redirected]");
for (let turn = 0; turn < 300; turn++) {
  const answer = readResponse(new Response("x", { status: 200 + (turn % 3), statusText: "s" + (turn % 2) }));
  if (turn % 149 === 0) say("response", answer);
}
const readParts = make(["u"], "return [u.href, u.pathname, u.search, u.searchParams === u.searchParams, u.host]");
for (let turn = 0; turn < 300; turn++) {
  const answer = readParts(new URL("http://h" + (turn % 2) + ".test/a/" + (turn % 3) + "?q=" + (turn % 5)));
  if (turn % 149 === 0) say("parts", answer);
}
const readSize = make(["b"], "return [b.size, b.type, b.byteLength, b.length]");
for (let turn = 0; turn < 300; turn++) {
  const answer = readSize(turn % 3 === 0 ? new Blob(["abc".repeat(turn % 4)], { type: "text/x" }) : turn % 3 === 1 ? new Uint8Array(turn % 5) : Buffer.alloc(turn % 6));
  if (turn % 100 < 3) say("size", answer);
}
// The getter runs code that collects.
const readBody = make(["r"], "const b = r.body; return [typeof b, b === r.body, r.bodyUsed]");
for (let turn = 0; turn < 200; turn++) {
  const answer = readBody(new Request("http://localhost/", { method: "POST", body: "text " + turn }));
  if (turn % 64 === 0) Bun.gc(true);
  if (turn % 99 === 0) say("body", answer);
}

// A name that the constructor stores on some objects and the prototype holds for the others.
class Router {
  constructor(lazy, odd) {
    this.routes = ["a", "b"];
    if (lazy) this.find = this.lazyFind;
    if (odd) this.find = odd;
  }
  lazyFind = name => "lazy " + name + " " + this.routes.length;
  find(name) {
    return "method " + name + " " + this.routes.length;
  }
  get size() {
    return this.routes.length;
  }
}
class Narrow extends Router {
  find(name) {
    return "narrow " + super.find(name);
  }
}
const ask = make(["router", "name"], "return router.find(name)");
const take = make(["router"], "return typeof router.find + ' ' + router.size");
const routers = [new Router(false), new Router(true), new Narrow(false), new Narrow(true), new Router(false, name => "odd " + name)];
for (let turn = 0; turn < 400; turn++) {
  const router = routers[turn % routers.length];
  const answer = ask(router, "n" + (turn % 2)) + " | " + take(router);
  if (turn >= 395) say("find", answer);
}
routers[0].find = undefined;
routers[1].find = 5;
delete routers[3].find;
Router.prototype.find = function (name) {
  return "replaced " + name;
};
for (const router of routers) {
  let answer;
  try {
    answer = ask(router, "z");
  } catch (error) {
    answer = error.constructor.name;
  }
  say("find later", answer, take(router));
}
Object.defineProperty(Router.prototype, "find", { get() { return () => "from a getter of " + this.routes.length; }, configurable: true });
for (const router of [new Router(false), routers[1], routers[4], new Narrow(false)]) say("find by getter", typeof router.find === "function" ? ask(router, "g") : typeof router.find);

// Empty lists.
const fresh = make([], "return []");
const filled = make(["n"], "const list = []; for (let i = 0; i < n; i++) list.push(i * 3); return list");
const pairs = make(["v"], "return { value: v, issues: [] }");
const kinds = make(["k"], "const list = []; if (k === 0) list.push(1.5); else if (k === 1) list.push('s'); else if (k === 2) list[3] = k; else if (k === 3) list.length = 7; else if (k === 4) list.unshift(k, k); else list.name = 'n'; return list");
let total = 0;
const kept = [];
for (let turn = 0; turn < 3000; turn++) {
  const list = fresh();
  total += list.length + filled(turn % 23).length + pairs(turn).issues.length;
  if (turn % 500 === 0) kept.push(list, filled(turn % 23), pairs(turn));
  if (turn % 1000 === 999) Bun.gc(true);
}
say("lists", total, kept);
for (const list of kept) if (Array.isArray(list)) list.push("later", list.length);
say("lists later", kept);
for (let k = 0; k < 6; k++) {
  const list = kinds(k);
  say("kind", k, list, list.length, Object.keys(list), 3 in list, list.name ?? null);
}
const one = fresh();
say("one", Array.isArray(one), one instanceof Array, Object.getPrototypeOf(one) === Array.prototype, one.concat([1], fresh()), [...one, ...filled(3)], one.join("-"), one.indexOf(1));
Object.freeze(one);
try {
  make(["l"], "'use strict'; l.push(1)")(one);
} catch (error) {
  say("frozen", error.constructor.name);
}
const sorted = filled(12).reverse().sort((a, b) => a - b);
say("sorted", sorted, filled(9).map(x => x + 1).filter(x => x & 1), filled(40).length, filled(40)[39]);
console.log(lines.join("\n"));
