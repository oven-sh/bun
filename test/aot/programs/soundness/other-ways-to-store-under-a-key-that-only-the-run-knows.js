// A name is stored directly on one object of a layout. Others get it through Reflect.set, descriptors and Object.assign under a key that only the run knows, and frozen, sealed and inheriting objects refuse or divert the store.
"use strict";
const names = JSON.parse('["late"]');
function record(i) {
  return { x: i, y: i + 1 };
}
function attempt(f) {
  try {
    return f();
  } catch (e) {
    return e.constructor.name;
  }
}
const named = record(0);
named.late = "text";
const a = record(1);
const b = record(2);
const c = record(3);
const d = Object.freeze(record(4));
const e = Object.preventExtensions(record(5));
const f = Object.seal(record(6));
const g = Object.create(record(7));
const h = record(8);
console.log(attempt(() => Reflect.set(a, names[0], 5)), a.late);
console.log(attempt(() => Object.defineProperty(b, names[0], { value: 5, writable: true, enumerable: true, configurable: true }).late));
console.log(attempt(() => Object.defineProperty(c, names[0], { get() { return 5; }, enumerable: true, configurable: true }).late));
console.log(attempt(() => (d[names[0]] = 5)), attempt(() => (e[names[0]] = 5)), attempt(() => (f[names[0]] = 5)));
console.log(attempt(() => (g[names[0]] = 5)), Object.keys(g).join(), Object.keys(Object.getPrototypeOf(g)).join());
console.log(attempt(() => Object.assign(h, Object.fromEntries([[names[0], 5]])).late));
for (const o of [named, a, b, c, d, e, f, g, h]) console.log(typeof o.late, JSON.stringify(o), Object.keys(o).join());
