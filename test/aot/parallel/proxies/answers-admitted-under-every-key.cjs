// A target whose properties are all configurable binds no answer of a trap, under whatever key it is asked: an index, a string put together, a name.
// COUNTER: ProxyTrapAnswersAdmitted >= 120
"use strict";
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
function late(o, key = "late") { o[key] = 5; return o; }
const symbol = Symbol("s");
const targets = () => [late({ a: 1 }), late(late({ a: 1, get b() { return this.a; } }), "7"), late({ a: 1 }, "other" + "s"), late({ a: 1 }, symbol),
  Object.defineProperty(late({ a: 1 }), "fixed", { value: 5 }), Object.defineProperty(late({ a: 1 }), "7", { value: 5 }), Object.defineProperty(late({ a: 1 }), "late", { value: 5, writable: true }),
  Object.defineProperty(late({ a: 1 }), "got", { get() { return 5; } }), Object.defineProperty(late({ a: 1 }), symbol, { value: 5 }), Object.defineProperty({ a: 1 }, "a", { value: 5, writable: false, configurable: false }),
  Object.freeze(late({ a: 1 })), Object.seal(late({ a: 1 })), Object.preventExtensions(late({ a: 1 })), late([1, 2, 3]), late(function f() {}), Object.assign(Object.create(null), { a: 1, late: 2 })];
const keys = () => ["a", "late", "fixed", "got", "absent", "7", 7, 0, ["la", "te"].join(""), "ot" + "her".concat("s"), symbol, "length"];
const handlers = [{ get: () => 5, set: () => true, has: () => false }, { get: () => 6, set: () => true, has: () => true }, { get: (t, k) => t[k], set: (t, k, v) => Reflect.set(t, k, v), has: (t, k) => k in t }, { get: () => undefined, set: () => false, has: () => 0 }];
function ask(p, key) {
  return [attempt(() => p[key]), attempt(() => key in p), attempt(() => { p[key] = 5; return "stored"; }), attempt(() => { p[key] = 6; return "stored"; }), attempt(() => Reflect.has(p, key)), attempt(() => p[key])].join();
}
for (let round = 0; round < 3; round++) {
  for (const handler of handlers)
    console.log(targets().map(target => keys().map(key => ask(new Proxy(target, handler), key)).join(" ; ")).join("\n"));
}
const target = late({ a: 1 }), p = new Proxy(target, handlers[0]);
for (const change of [() => {}, () => Object.defineProperty(target, "late", { configurable: false }), () => Object.defineProperty(target, "5", { value: 1 }), () => delete target.a, () => Object.freeze(target)]) {
  change();
  console.log(keys().concat("5", 5).map(key => ask(p, key)).join(" ; "));
}
