// super(a, b, ..) and super(...items) where Array is the parent: the kinds of the elements change from birth to birth, and arrays that are never filled.
const lines = []; let hash = 0;
function one(v) { return Object.is(v, -0) ? "-0" : typeof v === "object" && v ? (Array.isArray(v) ? "[" + v.length + "]" : "{" + Object.keys(v) + "}") : typeof v === "symbol" ? "symbol" : typeof v === "function" ? "f" : typeof v === "bigint" ? v + "n" : String(v); }
function show(a) { let s = a.constructor.name + " " + a.length + ":"; for (let i = 0; i < a.length && i < 9; i++) s += (i in a ? one(a[i]) : "hole") + ","; return s + Object.keys(a).filter((k) => !(k >>> 0 === +k)).join(); }
function note(a, every, k) { const s = typeof a === "string" ? a : show(a); for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; if (k % every === 0) lines.push(s); }
class Pair extends Array { constructor(a, b) { super(a, b); } get sum() { return this[0] + this[1]; } }
class Three extends Array { constructor(a, b, c) { super(a, b, c); this.name = "three"; } dot(o) { return this[0] * o[0] + this[1] * o[1] + this[2] * o[2]; } }
class Items extends Array { constructor(...items) { super(...items); this.count = items.length; } }
class Seven extends Array { constructor(x) { super(x, x, x, x, x, x, x); } }
class Below extends Three { constructor(v) { super(v, v, v); this.below = v; } }
class Holder extends Array { constructor(n) { super(n); this.rows = n; } again() { return new this.constructor(this.rows); } }
const kinds = [(k) => k, (k) => k + 0.5, (k) => "s" + k, (k) => (k & 1 ? k : k / 4), () => undefined, () => null, () => NaN, () => -0, (k) => [k], (k) => ({ k }), () => Symbol.iterator, (k) => BigInt(k), (k) => 2 ** 31 + k, (k) => -(2 ** 53) - k, () => Infinity, (k) => k % 3 === 0];
for (let round = 0; round < 4; round++) {
  for (let f = 0; f < kinds.length; f++) {
    const v = kinds[f], w = kinds[(f * 5 + round) % kinds.length];
    for (let k = 0; k < 140; k++) {
      note(new Pair(v(k), k & 64 ? w(k) : v(k)), 47, k); note(new Three(v(k), k > 100 ? w(k) : v(k), v(k + 1)), 53, k); note(new Seven(k & 32 ? v(k) : w(k)), 71, k); note(new Below(v(k)), 61, k);
      const i = new Items(...Array.from({ length: k % 6 === 1 ? 7 : k % 6 }, (_, p) => (p & 1 ? w(k) : v(p)))); note(i, 43, k); i.push(k); i[0] = v(k); note(i, 139, k);
      const h = new Holder(k % 5); if (k % 50 === 49) { h[0] = v(k); h[2] = w(k); } note(h.again(), 59, k); note(h, 67, k);
    }
  }
  note(new Items(...new Array(126).fill(round)), 1, 0); note(new Items(...new Array(127).fill(round / 2)), 1, 0); note(new Items(...new Array(200).fill("x")), 1, 0);
  const p = new Pair(1, 2.5), t = new Three(1, 2, 3); note(String(p.sum) + t.dot(new Three(0.5, 2, 1)) + t.map((x) => x / 2).join() + (t.concat([4]) instanceof Three) + Object.isFrozen(Object.freeze(p)), 1, 0);
  if (round === 1) Bun.gc(true);
}
note(Reflect.construct(Pair, [1, 2.5], Three), 1, 0); note(Reflect.construct(Three, ["a", 2, {}], class Other extends Array {}), 1, 0);
Object.defineProperty(Three.prototype, 1, { get() { return "got"; }, set(v) { note("set " + one(v), 1, 0); }, configurable: true });
for (let k = 0; k < 70; k++) { const t = new Three(k, k / 2, "e"); note(t, 23, k); t[1] = 5; delete t[1]; t[1] = 6; note(t, 23, k); }
console.log(lines.length, hash); console.log(lines.join("\n"));
