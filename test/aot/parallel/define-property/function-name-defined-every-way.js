// The name of a function is defined with every combination of attributes, on every kind of function, and read back in every way.
"use strict";
const describe = f => { const d = Object.getOwnPropertyDescriptor(f, "name"); return d ? ("value" in d ? JSON.stringify(d.value) + (d.writable ? "W" : "w") : "()") + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c") : "none"; };
const makers = [
  () => function () {}, () => function named() {}, () => () => {}, () => class {}, () => class Named {}, () => class { static name = "static"; }, () => class { static name() {} },
  () => async function () {}, () => function* () {}, () => ({ method() {} }).method, () => Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get,
  () => (function () {}).bind(null), () => Object.freeze(function frozen() {}), () => Object.preventExtensions(function closed() {}),
  () => Object.defineProperty(function fixed() {}, "name", { configurable: false }), () => Object.defineProperty(function open() {}, "name", { writable: true }),
];
function attempt(f, define) { try { define(f); return "ok"; } catch (e) { return e.constructor.name; } }
const definitions = [
  f => Object.defineProperty(f, "name", { value: "v1" }),
  f => Object.defineProperty(f, "name", { value: "v2", configurable: true }),
  f => Object.defineProperty(f, "name", { value: "v3", configurable: true, writable: false, enumerable: false }),
  f => Object.defineProperty(f, "name", { value: "v4", writable: false }),
  f => Object.defineProperty(f, "name", { value: "v5", enumerable: false }),
  f => Object.defineProperty(f, "name", { value: "v6", configurable: false }),
  f => Object.defineProperty(f, "name", { value: "v7", writable: true }),
  f => Object.defineProperty(f, "name", { value: "v8", enumerable: true }),
  f => Object.defineProperty(f, "name", { value: 9, configurable: true }),
  f => Object.defineProperty(f, "name", { value: Symbol.iterator, configurable: true }),
  f => Object.defineProperty(f, "name", { value: "", configurable: true }),
  f => Object.defineProperty(f, "name", { get() { return "getter"; }, configurable: true }),
  f => Object.defineProperty(f, "name", { configurable: true }),
];
for (let turn = 0; turn < 3; turn++) {
  for (let m = 0; m < makers.length; m++) {
    const line = [];
    for (let d = 0; d < definitions.length; d++) {
      const f = makers[m]();
      const first = attempt(f, definitions[d]);
      const second = attempt(f, definitions[(d + turn + 1) % definitions.length]);
      line.push(first + "," + second + "," + describe(f) + "," + String(f.name) + "," + Object.keys(f).join("+") + "," + Reflect.ownKeys(f).map(String).join("+"));
    }
    console.log(turn, m, line.join(" | "));
  }
}
function thrower() { throw new Error("from here"); }
Object.defineProperty(thrower, "name", { value: "renamed", configurable: true });
try { thrower(); } catch (e) { console.log(e.stack.split("\n")[1].replace(/\(.*[\\/]/, "(")); }
