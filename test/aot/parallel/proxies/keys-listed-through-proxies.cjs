// A proxy whose handler has no trap for the question lists the keys of its target, and the answer of a trap is admitted where the target has properties beside its fields.
// COUNTER: ProxyTargetsListed >= 30
// COUNTER: ProxyTrapAnswersAdmitted >= 20
"use strict";
const log = [];
const list = p => Object.keys(p).join() + "|" + Object.getOwnPropertyNames(p).join() + "|" + Reflect.ownKeys(p).map(String).join() + "|" + Object.getOwnPropertySymbols(p).length;
const attempt = f => { try { return String(f()); } catch (e) { return e.name + ": " + e.message; } };
const symbol = Symbol("s");
function late(o, key = "late") { o[key] = 5; return o; }
class Point { constructor(a) { this.a = a; } get sum() { return this.a; } }
class Handler { ownKeys() { return ["a"]; } }
const targets = () => [{ a: 1, b: 2 }, { a: 1, get b() { return 2; } }, {}, late({ a: 1 }), late(late({ a: 1 }), "other"), Object.freeze({ a: 1 }), Object.preventExtensions(late({ a: 1 })), Object.defineProperty({ a: 1, c: 2 }, "a", { enumerable: false }), Object.defineProperty(late({ a: 1 }), "fixed", { value: 5 }), { a: 1, [symbol]: 2 }, { 1: "one", a: 1, 0: "zero" }, [1, 2, 3], Object.assign([1], { a: 2 }), new Point(1), Object.assign(Object.create(null), { a: 1 }), function named() {}, new Proxy({ a: 1, b: 2 }, {}), (() => { const o = { a: 1, b: 2, c: 3 }; delete o.b; return o; })()];
const handlers = () => [{}, { get: (t, k) => t[k] }, { get: (t, k) => t[k], set: () => true, has: () => true }, { ownKeys: t => ["a"] }, { ownKeys: undefined }, { getOwnPropertyDescriptor: () => undefined }, { getOwnPropertyDescriptor(t, k) { log.push(k); return Reflect.getOwnPropertyDescriptor(t, k); } }, { get ownKeys() { log.push("asked"); return undefined; } }, Object.create({ ownKeys: t => ["a", "a"] }), Object.setPrototypeOf({}, { getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }) }), new Handler(), late({}), Object.freeze({}), new Proxy({}, { get(t, k) { log.push(k); } }), { ownKeys: 5 }];
for (let round = 0; round < 2; round++) for (const handler of handlers()) console.log(targets().map(target => attempt(() => list(new Proxy(target, handler)))).join(" ; "), log.splice(0).map(String).join());
const changing = {}, changed = new Proxy({ a: 1, b: 2 }, changing);
for (const change of [() => {}, () => { changing.ownKeys = () => ["b"]; }, () => { delete changing.ownKeys; }, () => { changing.getOwnPropertyDescriptor = () => undefined; }, () => { delete changing.getOwnPropertyDescriptor; }, () => { Object.setPrototypeOf(changing, { ownKeys: () => ["a"] }); }, () => { Object.setPrototypeOf(changing, Object.prototype); }]) { change(); console.log(attempt(() => list(changed))); }
const { proxy, revoke } = Proxy.revocable({ a: 1 }, {});
console.log(list(proxy)); revoke(); console.log(attempt(() => list(proxy)));
function answers(target, handler) {
  const p = new Proxy(target, handler), all = [];
  for (const name of ["a", "late", "fixed", "absent"]) {
    all.push(attempt(() => name in p));
    all.push(attempt(() => { p[name] = 5; return "stored"; }), attempt(() => { p[name] = 6; return "stored"; }));
  }
  all.push(attempt(() => "a" in p), attempt(() => "late" in p), attempt(() => "fixed" in p), attempt(() => "absent" in p), attempt(() => { p.a = 5; return "a"; }), attempt(() => { p.late = 5; return "late"; }), attempt(() => { p.fixed = 5; return "fixed"; }), attempt(() => { p.fixed = 6; return "fixed"; }));
  return all.join(" ; ");
}
for (const handler of [{ has: () => false, set: () => true }, { has: () => 0, set: () => 1 }, { has: (t, k) => k in t, set(t, k, v) { t[k] = v; return true; } }, { has: () => true, set: () => false }]) for (const target of targets()) console.log(answers(target, handler));
const log2 = ["g" + symbol.description, "s" + list({ a: 1 }).slice(0, 1)];
for (let k = 0; k < 4; k++) { log2.push("k" + k, "x".repeat(k) + k); console.log(log2.join(""), log2.join(), log2.join("é"), [true, log2.join("-"), "r" + k, 1.5, null].join()); }
console.log(["Ж" + log2[0], "b" + log2[1]].join(""), ["long".repeat(80) + log2[0], "b" + log2[1]].join("").length);
