// super(..) where Array is the parent, many times over: what the class has learned from its newest arrays is asked again between the births.
const lines = [];
function one(v) { return Object.is(v, -0) ? "-0" : typeof v === "object" && v ? (Array.isArray(v) ? "[" + v.length + "]" : "{" + Object.keys(v) + "}") : typeof v === "symbol" ? "symbol" : typeof v === "function" ? "f" : String(v); }
function show(a) { if (!Array.isArray(a)) return one(a); let s = a.constructor.name + " " + a.length + ":"; for (let i = 0; i < a.length && i < 7; i++) s += (i in a ? one(a[i]) : "hole") + ","; return s + Object.keys(a).filter((k) => !(k >>> 0 === +k)).join(); }
function attempt(f) { try { return show(f()); } catch (e) { return e.constructor.name + " " + e.message; } }
let hash = 0;
function add(s) { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; }
function note(s) { add(s); if (lines.length < 400) lines.push(s); }
class Held extends Array { constructor(n, fill) { super(n); for (let i = 0; i < n; i++) if (fill) this[i] = fill(i); this.rows = n; this.columns = 2; } size() { return this.rows * this.columns; } }
class Wide extends Array { constructor(n) { super(n); this.a = 1; this.b = 2; this.c = 3; this.d = 4; this.e = 5; this.f = n; } }
class Bare extends Array { constructor() { super(); } }
class Filled extends Array { constructor(v) { super(); this.push(v); this.push(v, v); } }
class Sub extends Held { constructor(n, fill) { super(n, fill); this.third = "t"; } }
const mixin = (S) => class Mixed extends S { get cells() { return this.length; } like(n) { return new this.constructor(n); } };
class OfMixin extends mixin(Array) { constructor(n) { super(n); this.held = n; } }
const fills = [(i) => i, (i) => i + 0.5, (i) => "t" + i, (i) => (i & 1 ? i : i / 4), (i) => [i], (i) => ({ i }), () => undefined, () => NaN, () => -0, (i) => (i ? 1e300 * i : 0)];
const lengths = [1, 2, 3, 4, 5, 8, 0, 13, 126, 127, 128, 1];
for (let round = 0; round < 6; round++) {
  for (let f = 0; f < fills.length; f++) {
    for (let k = 0; k < 131; k++) {
      const n = lengths[(k + round) % (round & 1 ? 5 : lengths.length)], a = new Held(n, fills[(f + (k >> 6)) % fills.length]);
      if (a.length !== n || a.rows !== n || a.size() !== 2 * n || !(a instanceof Held) || Object.keys(a).length !== n + 2) note("BAD " + show(a));
      if (k % 43 === 0) { note(show(a)); a.push(1); a[a.length + 1] = 2.5; a.extra = k; note(show(a.slice(-3)) + a.length + a.extra); }
    }
  }
  if (round === 2 || round === 4) Bun.gc(true);
}
for (let k = 0; k < 200; k++) {
  const w = new Wide(k % 9), b = new Bare(), p = new Filled(k & 64 ? k / 4 : k), s = new Sub(3, fills[k % 5]), m = new OfMixin(k % 4), l = m.like(2);
  b.push(k); b[2] = k / 2; if (k % 50 === 7) b.name = "n";
  add(show(w) + w.f + show(b) + show(p) + show(s) + s.third + show(m) + m.cells + show(l) + l.held);
  if (k % 33 === 0) note([w, b, p, s, m, l].map(show).join(" ; ") + " " + w.f + s.third + l.held);
}
const given = [3, 0, -0, -1, 1.5, "3", null, undefined, true, 2 ** 31, 2 ** 32 - 1, 2 ** 32, NaN, [4], {}, Symbol.iterator, 5n];
for (let k = 0; k < 4; k++) for (const g of given) note(attempt(() => new Held(g)) + " | " + attempt(() => new Wide(g)) + " | " + attempt(() => new OfMixin(g)));
// More classes than there are templates.
const many = []; for (let i = 0; i < 40; i++) { class Own extends Array { constructor(n) { super(n); this.own = i; } } many.push(Own); }
for (let k = 0; k < 200; k++) for (let i = 0; i < many.length; i += 1 + (k % 7)) { const a = new many[i](k % 5); if (a.own !== i || a.length !== k % 5 || Object.getPrototypeOf(a) !== many[i].prototype) note("BAD " + i + " " + show(a)); a[0] = k & 1 ? k / 2 : k; add(show(a)); }
// Another new.target, another parent, another prototype above.
for (let k = 0; k < 130; k++) { const r = Reflect.construct(Held, [2, fills[k % 3]], k & 1 ? Sub : Wide); add(show(r)); if (k > 127) note(show(r) + (r instanceof Sub) + (r instanceof Wide)); }
Held.prototype[1] = "above"; for (let k = 0; k < 70; k++) { const h = new Held(3); if (k > 67) note(show(h) + " " + h[1] + " " + h.indexOf("above")); } delete Held.prototype[1];
Object.setPrototypeOf(Wide, class { constructor(n) { this.only = n; } }); note(attempt(() => new Wide(4)) + one(new Wide(4).only));
Object.setPrototypeOf(Wide, Array); for (let k = 0; k < 70; k++) if (k > 67) note(attempt(() => new Wide(4))); else new Wide(2);
Object.setPrototypeOf(Bare, Map); note(attempt(() => new Bare() instanceof Map));
Object.setPrototypeOf(Held.prototype, Wide.prototype); for (let k = 0; k < 70; k++) { const h = new Held(2, fills[1]); if (k > 67) note(show(h) + (h instanceof Wide) + (h instanceof Held)); }
// An accessor at an index of a prototype, after many births.
Object.defineProperty(OfMixin.prototype, 2, { get() { return "got"; }, set(v) { note("set " + one(v)); }, configurable: true });
for (let k = 0; k < 140; k++) { const h = new OfMixin(3); h[0] = k; if (k % 34 === 1) { h[2] = k; note(show(h) + h[2] + h.length); } }
delete OfMixin.prototype[2];
for (let k = 0; k < 140; k++) { const h = new OfMixin(3); h[2] = k / 2; if (k % 34 === 1) note(show(h)); }
console.log(lines.length, hash); console.log(lines.join("\n"));
