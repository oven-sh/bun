// All proxies that the text of this program makes have a handler of one class or a handler without traps, and records of one shape for targets. Others arrive all the same: with a handler or a target that JSON.parse or Object.create made, revoked ones, and a proxy of a proxy. The places that read, test and store answer for each as plain code does.
// Flags: --aot-heat=everything-is-hot
const log = [];
const told = work => { try { return work(); } catch (error) { return error.constructor.name + ": " + error.message; } };
const shown = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function " + held.name : held);
function say(label, value) { console.log(label + ": " + shown(value) + (log.length ? " | " + log.splice(0).join(" ") : "")); }
function read(from) { return from.alpha; }
function readBoth(from) { return from.alpha + "," + from.beta; }
function test(from) { return "alpha" in from; }
function store(into, value) { into.alpha = value; return into.alpha; }
class Counting { constructor() { this.asks = 0; } get(t, key) { this.asks++; return t[key]; } has(t, key) { this.asks++; return key in t; } set(t, key, value) { this.asks++; t[key] = value; return true; } }
const record = (alpha, beta) => ({ alpha, beta });
function make(target, handler) { return new Proxy(target, handler); }
const every = work => [read, readBoth, test, from => store(from, 9)].map(ask => told(() => ask(work())));
const noTraps = () => ({});
const named = (...letters) => letters.join("");
const trapsFromElsewhere = () => { const handler = JSON.parse("{}"); handler[named("g", "e", "t")] = (t, key) => "elsewhere " + key; handler[named("h", "a", "s")] = () => true; handler[named("s", "e", "t")] = () => true; return handler; };
for (let round = 0; round < 3; round++) {
  say("the record", every(() => record(1, 2)));
  say("the class", every(() => make(record(1, 2), new Counting)));
  say("no traps", every(() => make(record(1, 2), noTraps())));
  say("a handler filled under computed names", every(() => make(record(1, 2), trapsFromElsewhere())));
  say("a handler out of a text", every(() => make(record(1, 2), JSON.parse("{}"))));
  say("a handler out of a text with traps that are no functions", every(() => make(record(1, 2), JSON.parse('{"get":1,"has":2,"set":3}'))));
  say("a handler made of nothing", every(() => make(record(1, 2), Object.create(null))));
  say("a handler below the class's instance", every(() => make(record(1, 2), Object.create(new Counting))));
  say("a target out of a text", every(() => make(JSON.parse('{"beta":2,"alpha":1}'), new Counting)));
  say("a target out of a text, no traps", every(() => make(JSON.parse('{"beta":2,"alpha":1}'), noTraps())));
  say("a target made of nothing", every(() => make(Object.create(null), new Counting)));
  say("a target that is a list", every(() => make([1, 2], noTraps())));
  say("a proxy of a proxy", every(() => make(make(record(1, 2), new Counting), noTraps())));
  say("a proxy for a handler", every(() => make(record(1, 2), make(noTraps(), noTraps()))));
  say("revoked", every(() => { const made = Proxy.revocable(record(1, 2), new Counting); made.revoke(); return made.proxy; }));
  say("revoked, no traps", every(() => { const made = Proxy.revocable(record(1, 2), noTraps()); made.revoke(); return made.proxy; }));
  say("not revoked", every(() => Proxy.revocable(record(1, 2), new Counting).proxy));
  say("revoked by the trap of a handler filled under computed names", (() => { const made = Proxy.revocable(record(1, 2), (() => { const handler = JSON.parse("{}"); handler[named("g", "e", "t")] = (t, key) => { made.revoke(); return t[key]; }; return handler; })()); return told(() => readBoth(made.proxy)); })());
  say("frozen", every(() => make(Object.freeze(record(1, 2)), new Counting)));
  say("frozen, no traps", every(() => make(Object.freeze(record(1, 2)), noTraps())));
  say("frozen, a handler filled under computed names", every(() => make(Object.freeze(record(1, 2)), trapsFromElsewhere())));
  say("an accessor in the record", every(() => { const target = record(1, 2); const proxy = make(target, noTraps()); Object.defineProperty(target, "alpha", { get() { return this === proxy ? "for the proxy" : "for another"; }, set(value) { log.push(this === proxy ? "set for the proxy" : "set for another"); } }); return proxy; }));
  say("the handler without traps is given one", (() => { const handler = noTraps(); const proxy = make(record(1, 2), handler); const said = [read(proxy), test(proxy), store(proxy, 3)]; handler.get = () => "late"; handler.has = () => false; handler.set = () => { log.push("late set"); return true; }; said.push(read(proxy), test(proxy), store(proxy, 4)); return said; })());
  say("an instance hides a method", (() => { const handler = new Counting; handler.get = () => "its own"; return [read(make(record(1, 2), handler)), handler.asks]; })());
  say("what is no object", [undefined, null, 1, "text"].map(value => [read, test, from => store(from, 9)].map(ask => String(told(() => ask(value))).split(":")[0])));
}
const handler = new Counting, things = [record(1, 2), make(record(3, 4), handler), make(record(5, 6), noTraps()), make(record(7, 8), trapsFromElsewhere())];
let sum = "";
for (let i = 0; i < 40000; i++) { const thing = things[i & 3]; const said = read(thing) + "" + test(thing) + store(thing, i & 7); if (i > 39995) sum += said + " "; }
console.log(sum, handler.asks, shown(things.map(read)));
