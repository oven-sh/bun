// An accessor defined over a field, or beside the fields, is defined again on the next object in the same state, wherever the property lies.
// COUNTER: AccessorDefinitionsReplayed >= 500
"use strict";
const attempt = f => { try { return String(f()); } catch (e) { return e.name; } };
const kept = new Map();
function half(key) { if (!kept.has(key)) kept.set(key, { get() { return this["_" + String(key)]; }, set(v) { this["_" + String(key)] = v; } }); return kept.get(key); }
function observe(o, key, enumerable, configurable) {
  const h = half(key), descriptor = { configurable, enumerable, get: h.get, set: h.set }, before = o[key];
  Object.defineProperty(o, key, descriptor);
  o[key] = before;
}
class A { constructor(n) { this.a = n; this.b = "b" + n; this.c = [n]; this.d = n + .5; this.e = null; this.f = undefined; this.g = true; this.h = n * 2; } }
class B extends A { constructor(n) { super(n); this.i = n; this.j = {}; } get k() { return 1; } }
const mark = Symbol("mark");
const show = o => Reflect.ownKeys(o).map(key => { const d = Object.getOwnPropertyDescriptor(o, key); return String(key) + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "") + (d.writable ? "w" : "") + (d.get ? "g" : "") + (d.set ? "s" : "") + String(attempt(() => o[key])); }).join(" ");
for (let round = 0; round < 24; round++) {
  const o = round % 3 ? new B(round) : new A(round);
  if (round % 8 === 7) delete o.c;
  for (const key of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "late", mark, "7"]) {
    if (round % 6 === 5 && key === "e") Object.preventExtensions(o);
    if (round % 12 === 10 && key === "d") o.before = 1;
    console.log(attempt(() => observe(o, key, round % 5 !== 1, round % 7 !== 2)));
    if (round % 4 === 1) console.log(attempt(() => observe(o, key, true, true)));
  }
  console.log(show(o), JSON.stringify(o), Object.keys(o).join());
  console.log(attempt(() => { o.a = 5; o.b++; return o.a + " " + o.b + " " + o._a; }), attempt(() => delete o.a), attempt(() => { o.a = 1; return o.a; }));
}
// Halves, missing attributes, a value over an accessor, an accessor over a value.
const forms = [{ get: () => 1 }, { set(v) {} }, { get: () => 2, enumerable: true }, { get: () => 3, configurable: true }, { get: undefined, set: undefined, enumerable: true, configurable: true }, { set(v) {}, enumerable: false, configurable: true },
  { value: 4 }, { value: 5, writable: true, enumerable: true, configurable: true }, {}, { enumerable: false }, { get: () => 6, enumerable: true, configurable: false }];
for (let first = 0; first < forms.length; first++) {
  for (let second = 0; second < forms.length; second++) {
    const rows = [];
    for (let n = 0; n < 3; n++) {
      const o = new A(n), p = { x: 1, get y() { return 2; } };
      rows.push([o, p, Object.freeze(new A(1)), Object.seal(new A(2))].map(x => ["a", "x", "y", "z"].map(key => attempt(() => (Object.defineProperty(x, key, forms[first]), "ok")) + attempt(() => (Object.defineProperty(x, key, forms[second]), "ok"))).join() + show(x)).join(" / "));
    }
    console.log(first, second, rows.join("\n"));
  }
}
// The object is a prototype, or becomes one; a setter runs between two definitions; the accessor is read through an heir.
for (let n = 0; n < 6; n++) {
  const o = new A(n);
  if (n % 2) Object.setPrototypeOf({}, o);
  const heir = Object.create(o);
  let log = "";
  Object.defineProperty(o, "a", { get() { log += "g"; return this === heir; }, set(v) { log += "s" + v; delete o.b; }, enumerable: true, configurable: true });
  o.a = n;
  Object.defineProperty(o, "b", { get: () => n, enumerable: true, configurable: true });
  console.log(heir.a, heir.b, log, Object.keys(o).join(), show(heir));
}
