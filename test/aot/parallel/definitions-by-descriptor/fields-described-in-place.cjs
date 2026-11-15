// Object.getOwnPropertyDescriptor of a field that is in its slot, of one that has left it, and of what is no field.
// COUNTER: FieldsDescribed >= 1000
"use strict";
const log = [];
const show = (value) => typeof value === "function" ? "function" : Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? String(value) : JSON.stringify(value) ?? "undefined";
const describe = (object, key) => {
  const found = Object.getOwnPropertyDescriptor(object, key);
  return found === undefined ? "none" : Reflect.ownKeys(found).map((name) => name + "=" + show(found[name])).join() + (Object.getPrototypeOf(found) === Object.prototype ? "" : " strange");
};
class Item {
  integer = 1; negative = -0; double = 0.5; text = "t"; truth = true; none = null; missing = undefined; list = [1]; big = 10n; symbol = Symbol.iterator; method = () => 1; #hidden = 1; mixed;
  constructor(mixed) { this.mixed = mixed; }
  get label() { return this.#hidden; }
  named() {}
}
class Heir extends Item { own = { a: 1 }; }
const keys = ["integer", "negative", "double", "text", "truth", "none", "missing", "list", "big", "symbol", "method", "mixed", "own", "label", "named", "absent", "constructor", "__proto__", "0", "#hidden"];
const mixed = [1, "s", null, undefined, 1.5, true, {}, NaN];
for (let turn = 0; turn < 60; turn++) for (const make of [(value) => new Item(value), (value) => new Heir(value), (value) => ({ integer: value, text: "t", get label() { return 1; }, named() {}, list: [] })]) {
  const object = make(mixed[turn % mixed.length]);
  for (const key of keys) { const found = describe(object, key); if (turn < 9) log.push(key + " " + found); }
  if (turn % 3 === 0) delete object.text;
  if (turn % 4 === 0) Object.defineProperty(object, "integer", { writable: false });
  if (turn % 5 === 0) Object.defineProperty(object, "list", { get: () => 1 });
  if (turn % 6 === 0) Object.freeze(object);
  if (turn % 7 === 0) Object.seal(object);
  for (const key of keys) { const found = describe(object, key); if (turn < 9 || turn % 20 === 0) log.push(key + " " + found); }
  const taken = Object.getOwnPropertyDescriptor(object, "mixed");
  if (taken) { taken.value = "changed"; taken.enumerable = false; if (describe(object, "mixed").includes("changed")) log.push("shared"); }
}
for (let turn = 0; turn < 400; turn++) {
  const known = new Item(mixed[turn % mixed.length]);
  for (const key of ["integer", "text", "list", "mixed", "absent"]) {
    const found = Object.getOwnPropertyDescriptor(known, key);
    if (turn < 8) log.push(key + " " + (found ? show(found.value) + found.writable + found.enumerable + found.configurable : "none"));
  }
}
const attempt = (action) => { try { return show(action()); } catch (error) { return error.name + ": " + error.message; } };
const item = new Item(1);
log.push(attempt(() => Object.getOwnPropertyDescriptor(null, "a")), attempt(() => Object.getOwnPropertyDescriptor(undefined)), attempt(() => Object.getOwnPropertyDescriptor("text", "length")), attempt(() => Object.getOwnPropertyDescriptor(1, "a")));
log.push(attempt(() => Object.getOwnPropertyDescriptor(item, { toString: () => "integer" })), attempt(() => Object.getOwnPropertyDescriptor(item, ["te", ""].join("xt"))), attempt(() => Object.getOwnPropertyDescriptor(item, "te" + "xt".slice(0, item.integer + 1))), attempt(() => Object.getOwnPropertyDescriptor(item)));
log.push(describe(new Proxy(item, {}), "integer"), describe([1, 2], "length"), describe([1, 2], 1), describe(class { static a = 1; }, "a"), describe(globalThis, "Infinity"), describe(Object.create({ a: 1 }), "a"));
console.log(log.length);
console.log(log.join("\n"));
