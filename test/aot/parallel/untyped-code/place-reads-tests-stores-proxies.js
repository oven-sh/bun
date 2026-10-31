// Three small functions read, test and store a name on whatever they are handed: the objects themselves, proxies of them made by other functions with handlers of a few kinds, proxies that were revoked, proxies of proxies, and what is no object at all. Each answers as if the proxy had been made where it is used.
// Flags: --aot-heat=everything-is-hot
const log = [];
const told = work => { try { return work(); } catch (error) { return error.constructor.name + ": " + error.message; } };
const shown = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function " + held.name : typeof held === "symbol" ? String(held) : typeof held === "bigint" ? held + "n" : held);
function say(label, value) { console.log(label + ": " + shown(value) + (log.length ? " | " + log.splice(0).join(" ") : "")); }
function read(from) { return from.alpha; }
function readBoth(from) { return from.alpha + "," + from.beta; }
function test(from) { return "alpha" in from; }
function store(into, value) { into.alpha = value; return into.alpha; }
function call(on) { return on.name(); }
class Counting { constructor() { this.asks = 0; } get(t, key, receiver) { this.asks++; return t[key]; } has(t, key) { this.asks++; return key in t; } set(t, key, value) { this.asks++; t[key] = value; return true; } }
const record = (alpha, beta) => ({ alpha, beta, name() { return this === undefined ? "nobody" : "alpha is " + this.alpha; } });
const counted = target => new Proxy(target, new Counting);
const bare = target => new Proxy(target, {});
const literal = target => new Proxy(target, { get(t, key) { log.push("get " + String(key)); return t[key]; } });
const forwarding = target => new Proxy(target, { get(t, key, receiver) { return Reflect.get(t, key, receiver); }, has(t, key) { return Reflect.has(t, key); }, set(t, key, value, receiver) { return Reflect.set(t, key, value, receiver); } });
const every = work => [read, readBoth, test, from => store(from, 9), call].map(ask => told(() => ask(work())));
for (let round = 0; round < 3; round++) {
  say("the object itself", every(() => record(1, 2)));
  say("a handler of a class", every(() => counted(record(1, 2))));
  say("a handler without traps", every(() => bare(record(1, 2))));
  say("a handler with a get trap alone", every(() => literal(record(1, 2))));
  say("a handler that hands on", every(() => forwarding(record(1, 2))));
  say("a proxy of a proxy", every(() => counted(literal(record(1, 2)))));
  say("a proxy of a proxy without traps", every(() => bare(bare(record(1, 2)))));
  say("a handler that is a proxy", every(() => new Proxy(record(1, 2), new Proxy({}, { get(t, key) { log.push("handler." + String(key)); return undefined; } }))));
  say("a handler made of nothing", every(() => new Proxy(record(1, 2), Object.create(null))));
  say("a handler below another", every(() => new Proxy(record(1, 2), Object.create(new Counting))));
  say("a handler that is a list, a function, a map", [[], function () { }, new Map].map(handler => every(() => new Proxy(record(1, 2), handler))));
  say("traps that are no functions", every(() => new Proxy(record(1, 2), { get: 1, has: "no", set: {} })));
  say("traps that are null", every(() => new Proxy(record(1, 2), { get: null, has: undefined, set: null })));
  say("revoked", every(() => { const made = Proxy.revocable(record(1, 2), new Counting); made.revoke(); return made.proxy; }));
  say("revoked, without traps", every(() => { const made = Proxy.revocable(record(1, 2), {}); made.revoke(); return made.proxy; }));
  say("revocable and not revoked", every(() => Proxy.revocable(record(1, 2), new Counting).proxy));
  say("revoked between two reads", (() => { const made = Proxy.revocable(record(1, 2), { get(t, key) { if (key === "alpha") made.revoke(); return t[key]; } }); return told(() => readBoth(made.proxy)); })());
  say("a target of another shape", every(() => counted({ beta: 2, gamma: 3, alpha: 1, name() { return "other"; } })));
  say("a target that is a list, a function, a map, a date", [[1], function named() { }, new Map, new Date(0)].map(target => every(() => counted(target))));
  say("a frozen target, an honest handler", every(() => counted(Object.freeze(record(1, 2)))));
  say("a frozen target, a handler that lies", every(() => new Proxy(Object.freeze(record(1, 2)), { get: () => "lie", has: () => false, set: () => true })));
  say("a target that is closed", every(() => new Proxy(Object.preventExtensions(record(1, 2)), { has: () => false })));
  say("a target whose field became an accessor", every(() => { const target = record(1, 2); const proxy = bare(target); Object.defineProperty(target, "alpha", { get() { return this === proxy ? "for the proxy" : this === target ? "for the target" : "for another"; }, set(value) { log.push(this === proxy ? "set for the proxy" : "set for another"); } }); return proxy; }));
  say("a target whose field was deleted", every(() => { const target = record(1, 2); delete target.alpha; return bare(target); }));
  say("a target below an accessor", every(() => { const target = Object.create({ get alpha() { return this === proxy ? "for the proxy" : "for another"; }, name() { return "above"; } }); const proxy = bare(target); return proxy; }));
  say("a handler that gets its trap late", (() => { const handler = {}; const proxy = new Proxy(record(1, 2), handler); const said = [read(proxy), test(proxy)]; handler.get = () => "late"; handler.has = () => false; said.push(read(proxy), test(proxy)); delete handler.get; said.push(read(proxy)); return said; })());
  say("a class whose method is replaced", (() => { class Handler { get() { return "declared"; } } const proxy = new Proxy(record(1, 2), new Handler); const said = [read(proxy)]; Handler.prototype.get = () => "replaced"; said.push(read(proxy)); delete Handler.prototype.get; said.push(read(proxy)); return said; })());
  say("an instance that hides the method of its class", (() => { const handler = new Counting; handler.get = () => "its own"; return [read(new Proxy(record(1, 2), handler)), handler.asks]; })());
  say("an object below a proxy", every(() => Object.create(literal(record(1, 2)))));
  say("what is no object", [undefined, null, 1, "text", true, 1n, Symbol.iterator].map(value => [read, test, from => store(from, 9)].map(ask => String(told(() => ask(value))).split(":")[0])));
  say("counts", (() => { const handler = new Counting, proxy = new Proxy(record(1, 2), handler); read(proxy); readBoth(proxy); test(proxy); store(proxy, 5); call(proxy); return handler.asks; })());
}
const handler = new Counting, things = [record(1, 2), new Proxy(record(3, 4), handler), bare(record(5, 6)), forwarding(record(7, 8))];
let sum = 0;
for (let i = 0; i < 40000; i++) { const thing = things[i & 3]; sum += read(thing) + test(thing) + store(thing, i & 7); }
console.log(sum, handler.asks, shown(things.map(read)));
