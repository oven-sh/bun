// The answers of traps are finished without the run time where the target's extra properties are all configurable.
// COUNTER: operationAOTValidateAnswerOfProxyTrap <= 60
// COUNTER: operationAOTFinishHasThroughProxy <= 60
// COUNTER: operationAOTFinishSetThroughProxy <= 60
"use strict";
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
function late(o, key = "late") { o[key] = 5; return o; }
const handler = { get: (t, k) => k.length, set: () => true, has: () => false };
function ask(p, names) {
  let sum = 0;
  for (const name of names) {
    sum += p[name];
    sum += name in p ? 1 : 2;
    p[name] = sum;
  }
  return sum;
}
const targets = [late({ a: 1 }), late({ a: 1 }, "other" + "s"), late(late({ a: 1, b: 2 }), "la" + "ter"), late(Object.assign({}, { a: 1 })), late(JSON.parse('{"a":1}'))];
let total = 0;
for (let round = 0; round < 40; round++) for (const target of targets) total += ask(new Proxy(target, handler), ["a", "late", "others", "absent"]);
console.log(total);
// A property that is fixed binds the answer, whenever it comes to be.
const fixed = late({ a: 1 }), p = new Proxy(fixed, handler);
for (const change of [() => {}, () => Object.defineProperty(fixed, "late", { configurable: false }), () => Object.defineProperty(fixed, "late", { writable: false }), () => Object.defineProperty(fixed, "a", { value: 1, configurable: false }), () => Object.defineProperty(fixed, "got", { get() { return 1; } }), () => Object.preventExtensions(fixed), () => Object.seal(fixed), () => Object.freeze(fixed)]) {
  change();
  console.log(["a", "late", "got", "absent"].map(name => [attempt(() => p[name]), attempt(() => name in p), attempt(() => { p[name] = 7; return "stored"; })].join()).join(" ; "));
}
