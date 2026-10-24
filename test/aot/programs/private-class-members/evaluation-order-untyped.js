// The order of evaluation around private members: receiver, value, default, element and argument (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

const log = [];
function note(what, v) { log.push(what); return v; }
function told(f) { log.length = 0; const r = said(f); return log.join(" ") + " -> " + r; }
function boom() { log.push("boom"); throw new RangeError("boom"); }
class C {
  static #f = 0;
  static #x = 0;
  static #hidden = 0;
  static set #s(v) { log.push("setter " + v); C.#hidden = v; }
  static get #s() { log.push("getter"); return C.#hidden; }
  static get #g() { log.push("getter"); return 1; }
  static set #w(v) { log.push("setter " + v); }
  static #m() { return 1; }
  static field(o) { o.#f = note("value", 5); }
  static fieldThrows(o) { o.#f = boom(); }
  static viaThis() { this.#f = note("value", 5); }
  static receiver(o) { o().#f = note("value", 5); }
  static setter(o) { o.#s = note("value", 5); }
  static getterOnly(o) { o.#g = note("value", 5); }
  static method(o) { o.#m = note("value", 5); }
  static add(o) { o.#f += note("value", 5); }
  static addSetter(o) { o.#s += note("value", 5); }
  static addGetterOnly(o) { o.#g += note("value", 5); }
  static addSetterOnly(o) { o.#w += note("value", 5); }
  static addMethod(o) { o.#m += note("value", 5); }
  static increment(o) { return o.#f++; }
  static incrementSetterOnly(o) { return o.#w++; }
  static incrementGetterOnly(o) { return ++o.#g; }
  static or(o) { return o.#f ||= note("value", 5); }
  static and(o) { return o.#f &&= note("value", 6); }
  static nullish(o) { return o.#f ??= note("value", 7); }
  static nullishSetterOnly(o) { return o.#w ??= note("value", 7); }
  static orGetterOnly(o) { return o.#g ||= note("value", 7); }
  static andGetterOnly(o) { return o.#g &&= note("value", 7); }
  static array(o, it) { [o.#f] = it; }
  static arrayDefault(o) { [o.#f = note("default", 3)] = []; }
  static arrayRest(o, it) { [...o.#x] = it; }
  static object(o) { ({ a: o.#f } = { a: 9 }); }
  static objectRest(o) { ({ ...o.#x } = { a: 9 }); }
  static forOf(o) { for (o.#f of [note("element", 1)]) log.push("body"); }
  static forIn(o) { for (o.#x in { a: 1 }) log.push("body"); }
  static call(o) { return o.#m(note("argument", 1)); }
  static read(o) { return o.#f; }
  static chain(o) { return o?.#f; }
  static reset() { C.#f = 0; C.#x = 0; }
  static now() { return C.#f + " " + String(C.#x); }
}
class D extends C {}
function steps() {
  return { [Symbol.iterator]() { log.push("open"); return { next() { log.push("next"); return { done: false, value: 4 }; }, return() { log.push("return"); return {}; } }; } };
}
const others = [["an heir", D], ["an object below", Object.create(C)], ["a proxy", new Proxy(C, {})], ["an instance", new C()], ["a function", function () {}], ["null", null], ["undefined", undefined], ["a number", 1], ["a string", "s"], ["a boolean", true], ["a symbol", Symbol()], ["a bigint", 1n]];
const doors = ["field", "fieldThrows", "setter", "getterOnly", "method", "add", "addSetter", "addGetterOnly", "addSetterOnly", "addMethod", "increment", "incrementSetterOnly", "incrementGetterOnly", "or", "and", "nullish", "nullishSetterOnly", "orGetterOnly", "andGetterOnly", "arrayDefault", "object", "objectRest", "forOf", "forIn", "call", "read", "chain"];
for (const door of doors) {
  C.reset();
  console.log(door + " on the class: " + told(() => (C)[door](C)) + " now " + C.now());
  for (const [name, o] of others) console.log(door + " on " + name + ": " + told(() => (C)[door](o)) + " now " + C.now());
}
for (const [name, o] of [["the class", C], ...others]) {
  C.reset();
  console.log("array on " + name + ": " + told(() => C.array(o, steps())) + " now " + C.now());
  console.log("arrayRest on " + name + ": " + told(() => C.arrayRest(o, [1, 2])));
  console.log("receiver on " + name + ": " + told(() => C.receiver(() => note("receiver", o))));
}
console.log("this is the class: " + told(() => C.viaThis()));
console.log("this is an heir: " + told(() => D.viaThis()));
console.log("this is something else: " + told(() => C.viaThis.call({})));
