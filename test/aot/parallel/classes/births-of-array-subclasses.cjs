// super(..) where Array is the parent: every kind of argument, lists that become lists of every kind, properties beside the elements, collections in between.
const lines = [];
function one(v) { return Object.is(v, -0) ? "-0" : typeof v === "object" && v ? (Array.isArray(v) ? "[" + v.length + "]" : "{" + Object.keys(v) + "}") : typeof v === "symbol" ? "symbol" : typeof v === "function" ? "f" : String(v); }
function show(a) { if (!Array.isArray(a)) return one(a); let s = a.constructor.name + " " + a.length + ":"; for (let i = 0; i < a.length && i < 6; i++) s += (i in a ? one(a[i]) : "hole") + ","; return s + Object.keys(a).filter((k) => !(k >>> 0 === +k)).join(); }
function attempt(f) { try { return show(f()); } catch (e) { return e.constructor.name + " " + e.message; } }
class Bare extends Array {}
class Sized extends Array { constructor(n) { super(n); } }
class Held extends Array { constructor(n, fill) { super(n); for (let i = 0; i < n; i++) if (fill) this[i] = fill(i); this.rows = n; this.columns = fill ? 1 : 0; this.more = "m"; this.name = n; this.last = this; } }
class Empty extends Array { constructor(...items) { super(); for (const item of items) this.push(item); } top() { return this[this.length - 1]; } }
class Listed extends Array { constructor(...items) { super(...items); } }
class Below extends Held { constructor(n) { super(n, (i) => i / 2); this.extra = { n }; } }
const mixin = (S) => class Mixed extends S { get cells() { return this.length; } };
class OfMixin extends mixin(Array) { constructor(n) { super(n); this.held = n; } }
class OfView extends mixin(Object) { constructor(n) { super(n); this.held = n; } }
const given = [0, 1, 3, 126, 127, 128, 300, "4", 2.5, -1, 4294967295, 4294967296, undefined, null, NaN, -0, 3.0, [2], {}, true];
for (const C of [Bare, Sized, Held, Listed, OfMixin]) for (const n of given) lines.push(C.name + " " + attempt(() => new C(n)));
for (const C of [Bare, Empty, Listed]) lines.push(attempt(() => new C()), attempt(() => new C(1, 2.5, "x")), attempt(() => new C("only")), attempt(() => C.of(7, 8)), attempt(() => C.from([1, 2, 3], (x) => x / 2)), attempt(() => new C(5, 6).map((x) => x + 0.5)), attempt(() => new C(3, 1, 2).sort()), attempt(() => new C(1, 2).concat([3])));
const fills = [(i) => i, (i) => i + 0.5, (i) => "t" + i, (i) => (i & 1 ? i : i / 4), (i) => ({ i }), (i) => [i], () => undefined, () => NaN, () => -0];
for (let round = 0; round < 12; round++) {
  for (const fill of fills) {
    let t = 0, kept;
    for (let i = 0; i < 70; i++) { const a = new Held(i % 5, fill); t += a.length + a.rows + a.columns; if (i === 64) kept = a; }
    kept.push(fill(9)); kept.unshift(0.25); kept.length = 4;
    lines.push(round + " " + t + " " + show(kept) + " " + (kept.last === kept) + " " + (kept instanceof Held) + " " + JSON.stringify(kept.slice(0, 2)));
  }
  if (round % 3 === 1) Bun.gc(true);
  const e = new Empty(); for (let i = 0; i < 9; i++) e.push(round & 1 ? i / 2 : i); lines.push(show(e) + " " + e.top() + " " + e.pop() + " " + e.length);
  const b = new Below(3), m = new OfMixin(2), v = new OfView(2); m[0] = round; m.push(b);
  lines.push(show(b) + " " + b.extra.n + " " + show(m) + " " + m.cells + " " + m.held + " " + Array.isArray(v) + " " + v.held);
}
lines.push(attempt(() => Reflect.construct(Sized, [3], Held)), attempt(() => Reflect.construct(Array, [3], Held)), attempt(() => Reflect.construct(Held, [2, (i) => i], Array)), attempt(() => Reflect.construct(Sized, [2], class Other {})));
Held.prototype[1] = "above";
const holed = new Held(3); lines.push(show(holed) + " " + holed[1] + " " + holed.indexOf("above") + " " + [...holed].join());
delete Held.prototype[1];
Object.setPrototypeOf(Sized, class { constructor(n) { this.only = n; } });
lines.push(attempt(() => new Sized(4)), attempt(() => new Sized(4).only));
Object.setPrototypeOf(Bare, Map); lines.push(attempt(() => new Bare([[1, 2]]) instanceof Map));
console.log(lines.join("\n"));
