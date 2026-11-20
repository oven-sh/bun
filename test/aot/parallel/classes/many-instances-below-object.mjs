// Classes below mixins over Object, born many times: fields, arguments that Object ignores, other new.targets, changed prototypes, collections in between, more classes than templates.
const lines = []; let hash = 0;
function show(o) { if (o === null || typeof o !== "object") return typeof o + String(o); return (o.constructor && o.constructor.name) + JSON.stringify(Object.entries(o).map(([k, v]) => [k, typeof v === "object" && v ? "o" : typeof v === "function" ? "f" : Object.is(v, -0) ? "-0" : typeof v === "number" && v !== v ? "NaN" : v])); }
function note(o, every, k) { const s = typeof o === "string" ? o : show(o); for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; if (k % every === 0) lines.push(s); }
function attempt(f) { try { return show(f()); } catch (e) { return e.constructor.name + " " + e.message; } }
const mixin = (S) => class Mixed extends S { twice() { return this.v * 2; } static get [Symbol.species]() { return this; } like(v) { return new this.constructor[Symbol.species](v); } };
class View extends mixin(Object) { constructor(m) { super(); this.matrix = m; this.rows = m.length; this.columns = 2; } get(i) { return this.matrix[i]; } }
class Plain extends mixin(Object) { constructor(v) { super(v); this.v = v; } }
class Bare extends mixin(Object) {}
class Given extends mixin(Object) { constructor(...all) { super(...all); this.count = all.length; } }
class Fields extends mixin(Object) { a = 1; b = this.a + 1; #c = 3; constructor(v) { super(1, 2, 3, 4, 5, 6); this.v = v; this.c = this.#c; } }
class Wide extends mixin(Object) { constructor(v) { super(); for (const k of "abcdefghijklmnopqrst") this[k] = v; } }
class Slots extends mixin(Object) { constructor(v) { super(); this.a = v; this.b = v + 0.5; this.c = "c" + v; this.d = [v]; this.e = v & 1 ? v : null; this.f = undefined; this.g = this; this.h = -0; this.i = NaN; this.j = v > 3; } }
class Below extends Plain { constructor(v) { super(v); this.below = this.v + 1; } }
class Returns extends mixin(Object) { constructor(v) { super(); if (v % 3 === 0) return { other: v }; this.v = v; } }
class Direct extends Object { constructor(v) { super(v, v, v); this.v = v; } }
const all = [View, Plain, Bare, Given, Fields, Wide, Slots, Below, Returns, Direct];
const argumentOf = (C, k) => (C === View ? [k, k + 1] : k);
for (let round = 0; round < 4; round++) {
  for (const C of all) for (let k = 0; k < 150; k++) {
    const o = new C(argumentOf(C, k), k, "x", {}); note(o, 49, k); if (!(o instanceof C) && C !== Returns) note("BAD", 1, 0);
    if (k % 37 === 5) { o.late = k; delete o.v; o[k] = 1; note(o, 1, 0); if (o.like) note(attempt(() => o.like(argumentOf(C, k))), 1, 0); note(String(Object.isExtensible(o)) + Object.keys(Object.freeze(o)).length, 1, 0); }
  }
  if (round === 1) Bun.gc(true);
  if (round === 2) for (let i = 0; i < 40; i++) { class Own extends mixin(Object) { constructor(v) { super(); this.own = i; this.v = v; } } for (let k = 0; k < 6; k++) { const o = new Own(k); if (o.own !== i || o.v !== k || Object.getPrototypeOf(o) !== Own.prototype) note("BAD " + i, 1, 0); note(o, 5, k); } }
}
for (let k = 0; k < 70; k++) { note(Reflect.construct(Plain, [k], Slots), 33, k); note(Reflect.construct(Plain, [k], function F() {}), 33, k); note(Reflect.construct(Object, [k], Plain), 33, k); note(Reflect.construct(Direct, [k], Array), 33, k); }
Plain.prototype.twice = function () { return "replaced"; }; note(String(new Plain(2).twice()) + new Below(3).twice(), 1, 0);
Object.setPrototypeOf(Plain.prototype, { above: "above", twice: 5 }); for (let k = 0; k < 9; k++) note(new Plain(k).above + typeof new Plain(k).twice, 4, k);
Object.defineProperty(Slots.prototype, "a", { set(v) { note("set " + v, 1, 0); }, get() { return "got"; }, configurable: true }); for (let k = 0; k < 5; k++) { const o = new Slots(k); note(show(o) + o.a, 2, k); }
Object.setPrototypeOf(Object.getPrototypeOf(Plain), class Q { constructor(v) { this.q = v; } }); for (let k = 0; k < 5; k++) note(attempt(() => new Plain(k)), 2, k);
Object.setPrototypeOf(View, Array); for (let k = 1; k < 5; k++) note(attempt(() => new View([k])), 1, k);
Object.setPrototypeOf(Bare, Map); note(attempt(() => new Bare([[1, 2]])), 1, 0);
console.log(lines.length, hash); console.log(lines.join("\n"));
