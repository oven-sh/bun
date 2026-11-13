// Integers stored by name by code that knows nothing of the object: into fields whose types take every int32, some, or none.
"use strict";
const log = [];
const show = (value) => value === null || typeof value !== "object" ? Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? String(value) : typeof value === "function" ? "function" : String(value) : JSON.stringify(value);
const set = (object, key) => {
  switch (key) {
    case 0: return (value) => { object.a = value; };
    case 1: return (value) => { object.b = value; };
    case 2: return (value) => { object.c = value; };
    case 3: return (value) => { object.d = value; };
    case 4: return (value) => { object.e = value; };
    case 5: return (value) => { object.f = value; };
    default: return (value) => { object.g = value; };
  }
};
class Mixed { a = 0; b = "s"; c = 0.5; d = true; e = null; f = undefined; g = [1]; }
class Counted { a = 1; b = 2; c = 3; d = 4; e = 5; f = 6; g = 7; step() { this.a = this.a + 1 & 255; this.b = this.b % 7; this.c |= 0; this.d = -this.d; this.e = this.e * 2 % 1000003; this.f = this.f > 5 ? 0 : 6; return this; } }
class Named { a = "x"; b = "y"; c = "z"; d = "w"; e = "v"; f = "u"; g = "t"; get all() { return this.a + this.b + this.c + this.d + this.e + this.f + this.g; } }
class Objects { a = {}; b = []; c = null; d = new Map(); e = () => 1; f = 10n; g = Symbol.iterator; }
class Guarded { #a = 1; get a() { return this.#a; } set a(value) { this.#a = value * 2; } b = 1; get c() { return "c"; } d = 1; e = 1; f = 1; g = 1; }
class Heir extends Mixed { h = 1; a = "heir"; }
const literal = () => ({ a: 1, b: undefined, c: "c", d: null, e: 1.5, f: 2, g: -0 });
const makers = [() => new Mixed(), () => new Counted().step(), () => new Named(), () => new Objects(), () => new Guarded(), () => new Heir(), literal, () => Object.create(new Mixed()), () => [], () => function () {}, () => new Proxy(new Mixed(), {}), () => Object.assign(Object.create(null), { a: 1, b: 2 })];
const values = [0, 1, -1, 2147483647, -2147483648, 4294967295, 0.5, -0, NaN, "text", true, null, undefined, 7n];
const attempt = (action) => { try { return show(action()); } catch (error) { return error.name; } };
for (let turn = 0; turn < 40; turn++) for (const make of makers) for (let key = 0; key < 7; key++) {
  const object = make(), name = "abcdefg"[key], store = set(object, key);
  let line = "";
  for (let index = 0; index < values.length; index++) {
    line += attempt(() => { store(values[(index + turn) % values.length]); return object[name]; }) + " ";
    if (index % 3 === 0) line += attempt(() => { store(index + turn); return object[name]; }) + " ";
  }
  if (turn % 9 === 0) line += attempt(() => { delete object[name]; store(turn); return object[name]; }) + " " + Object.keys(object).join();
  if (turn % 10 === 1) { Object.freeze(object); line += attempt(() => { store(turn); return object[name]; }); }
  if (turn % 10 === 2) { try { Object.defineProperty(object, name, { writable: false }); } catch {} line += attempt(() => { store(turn); return object[name]; }); }
  if (turn % 10 === 3) { try { Object.defineProperty(object, name, { get: () => "got", set: undefined }); } catch {} line += attempt(() => { store(turn); return object[name]; }); }
  if (turn % 10 === 4) { try { Object.defineProperty(object, name, { get() { return this.kept; }, set(value) { this.kept = value + 1; }, configurable: true }); } catch {} line += attempt(() => { store(turn); return object[name]; }); }
  if (turn % 10 === 5) { Object.preventExtensions(object); line += attempt(() => { store(turn); return object[name]; }); }
  line += attempt(() => object.all);
  if (object.step) line += attempt(() => object.step());
  if (turn < 3 || turn % 8 === 0) log.push(key + " " + line);
}
console.log(log.length);
console.log(log.join("\n"));
