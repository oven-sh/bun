// Object.defineProperty with its descriptor written in place: values, accessors, every flag present, absent, true and false, on ordinary objects, literals, instances, functions, arrays, frozen and sealed objects, under names, indexes and symbols.
"use strict";
const lines = [];
function show(o, k) {
  const d = Object.getOwnPropertyDescriptor(o, k);
  lines.push(String(k) + ":" + (d ? Object.keys(d).map((n) => n + "=" + (typeof d[n] === "function" ? "f" : String(d[n]))).join(",") : "none"));
}
function attempt(f) { try { return f(); } catch (e) { lines.push(e.constructor.name); } }
class Point { constructor() { this.x = 1; this.y = 2; } }
const symbol = Symbol("s");
function define(o) {
  attempt(() => Object.defineProperty(o, "a", { value: 1 }));
  attempt(() => Object.defineProperty(o, "b", { value: 2, writable: true }));
  attempt(() => Object.defineProperty(o, "c", { value: 3, enumerable: true, configurable: true, writable: false }));
  attempt(() => Object.defineProperty(o, "d", { get() { return this.b * 2; }, enumerable: true }));
  attempt(() => Object.defineProperty(o, "e", { get: function () { return 5; }, set: function (v) { this.b = v; }, configurable: true }));
  attempt(() => Object.defineProperty(o, "f", { set(v) { this.b = v + 1; } }));
  attempt(() => Object.defineProperty(o, "g", {}));
  attempt(() => Object.defineProperty(o, "x", { value: "again", enumerable: false }));
  attempt(() => Object.defineProperty(o, "a", { value: 1 }));
  attempt(() => Object.defineProperty(o, "a", { value: 9 }));
  attempt(() => Object.defineProperty(o, "c", { value: undefined }));
  attempt(() => Object.defineProperty(o, "e", { value: 7 }));
  attempt(() => Object.defineProperty(o, 0, { value: "zero", enumerable: true }));
  attempt(() => Object.defineProperty(o, symbol, { value: "sym", configurable: true }));
  attempt(() => Object.defineProperty(o, "h", { get: undefined }));
  attempt(() => Object.defineProperty(o, "i", { get: 1 }));
  attempt(() => Object.defineProperty(o, "j", { value: 1, get() {} }));
  attempt(() => Object.defineProperty(o, "k", { enumerable: 1, configurable: "", writable: null, value: NaN }));
  for (const k of ["a", "b", "c", "d", "e", "f", "g", "x", 0, symbol, "h", "i", "j", "k"]) show(o, k);
  attempt(() => { o.f = 10; o.e = 3; });
  lines.push(Object.keys(o).join() + "|" + String(o.b) + "|" + String(o.d) + "|" + JSON.stringify(o));
}
const targets = [() => ({}), () => ({ x: 1, b: 0 }), () => new Point(), () => function named() {}, () => [1, 2], () => Object.freeze({ x: 1 }), () => Object.seal({ a: 0, x: 1 }), () => Object.preventExtensions({ c: 1 }), () => Object.create(null), () => new Map()];
for (let round = 0; round < 60; round++) {
  lines.length = 0;
  for (const make of targets) define(make());
}
attempt(() => Object.defineProperty(1, "a", { value: 1 }));
attempt(() => Object.defineProperty(undefined, "a", { value: 1 }));
lines.push(Object.defineProperty({}, "r", { value: 4, enumerable: true }).r);
const exported = {};
for (const name of ["one", "two", "three"]) Object.defineProperty(exported, name, { enumerable: true, get: function () { return name.length; } });
lines.push(JSON.stringify(exported));
console.log(lines.join("\n"));
