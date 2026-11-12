// Classes that extend Array and views: their callback methods, and what a callback changes in the middle.
const lines = [], log = []; let hash = 0;
function one(v) { return Object.is(v, -0) ? "-0" : Array.isArray(v) ? v.constructor.name + "[" + Array.from(v, one).join() + "]" : ArrayBuffer.isView(v) ? v.constructor.name + "(" + Array.from(v, one).join() + ")" : v && typeof v === "object" ? "{}" : typeof v === "symbol" ? "symbol" : String(v); }
function attempt(f) { try { return one(f()); } catch (e) { return e.constructor.name; } }
function note(s) { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; if (lines.length < 300) lines.push(s); }

class A extends Array {
  folded() { return this.reduce((a, b) => a + b, 0); }
  foldedRight() { return this.reduceRight((a, b) => a + "," + b, ""); }
  foldedFirst() { return this.reduce((a, b) => a + b); }
  each() { let s = 0; this.forEach((v, i) => { s += v * i; }); return s; }
  some2(x) { return this.some((v) => v === x); }
  every2(x) { return this.every((v) => v !== x); }
  find2(x) { return one(this.find((v) => v === x)) + this.findIndex((v) => v === x) + one(this.findLast((v) => v !== x)) + this.findLastIndex((v) => v === x); }
  mapped() { return this.map((v) => v + 1); }
  filtered() { return this.filter((v) => v > 1); }
  flat2() { return this.flatMap((v) => [v, v]); }
  chained() { return this.map((v) => v * 2).filter((v) => v > 2).reduce((a, b) => a + b, 0); }
  chainedPlain() { return [...this].map((v) => v * 2).filter((v) => v > 2).length; }
  mean() { return this.length ? this.reduce((a, b) => a + b, 0) / this.length : 0; }
  deviation() { const m = this.mean(); return Math.sqrt(this.reduce((s, v) => s + (v - m) ** 2, 0)); }
  positions() { let s = ""; this.forEach((v, i, self) => { s += i + (self === this) + (i in self); }); return s; }
  withThis() { let s = ""; this.forEach(function (v) { s += this.k + one(v); }, { k: "k" }); return s; }
  grows() { let n = 0; this.forEach((v) => { if (n++ < 2) this.push(v); }); return n + ":" + this.length; }
  shrinks() { let n = 0; this.forEach(() => { n++; if (n === 2) this.length = 2; }); return n + ":" + this.length; }
  holes() { let n = 0; this.forEach((v, i) => { n++; if (i === 0) delete this[2]; }); return n; }
  kinds(x) { let s = 0; this.forEach((v, i) => { if (i === 1) this[2] = x; s += v; }); return s; }
  throwsAt(k) { this.forEach((v, i) => { log.push(i); if (i === k) throw new RangeError("at"); }); return "none"; }
}
class Other extends Array { each() { return "other"; } forEach(f) { let n = 0; for (const v of this) f(v, n++, "own"); return "own"; } run() { let s = ""; this.forEach((v, i, w) => { s += one(v) + i + one(w); }); return s; } folded() { return this.reduce((a, b) => a + b, 1); } }
class Named extends A { static get [Symbol.species]() { return Array; } constructor(...a) { super(...a); this.tag = "t"; } }
class V extends Float64Array {
  folded() { return this.reduce((a, b) => a + b, 0); }
  each() { let s = 0; this.forEach((v, i) => { s += v * i; }); return s; }
  some2(x) { return this.some((v) => v === x) + "" + this.every((v) => v !== x); }
  find2(x) { return one(this.find((v) => v === x)) + this.findIndex((v) => v === x); }
  mapped() { return this.map((v) => v + 1); }
  filtered() { return this.filter((v) => v > 1); }
  dot(v) { return this[0] * v[0] + this[1] * v[1]; }
  add(v) { this[0] += v[0]; this[1] += v[1]; return this; }
  mixed(x) { let s = 0; this.forEach((v, i) => { if (i === 1) this[2] = x; s += v; }); return s; }
}
class I extends Int16Array { folded() { return this.reduce((a, b) => a + b, 0); } each() { let s = 0; this.forEach((v) => { s += v; }); return s; } max() { return this.reduce((a, b) => Math.max(a, b), -Infinity); } dot(v) { return this[0] * v[0]; } }
const onA = ["folded", "foldedRight", "foldedFirst", "each", "mapped", "filtered", "flat2", "chained", "chainedPlain", "mean", "deviation", "positions", "withThis"];
const changing = ["grows", "shrinks", "holes"];
const fills = [(i) => i, (i) => i + 0.5, (i) => "s" + i, (i) => (i === 2 ? undefined : i), (i) => (i === 2 ? NaN : i), () => -0, (i) => 2 ** 31 - 2 + i, (i) => (i & 1 ? i : i / 4), (i) => BigInt(i), (i) => ({ valueOf() { log.push(i); return i; } })];
const filled = (C, n, f) => { const m = new C(); for (let i = 0; i < n; i++) m.push(f(i)); return m; };
function ask(m, names) { let s = ""; for (const n of names) s += n + attempt(() => m[n]()) + "|"; return s; }
function askAll(C) {
  for (const f of fills) for (const n of [0, 1, 4, 9]) {
    const m = filled(C, n, f);
    for (let round = 0; round < 3; round++) note(ask(m, onA) + attempt(() => m.some2?.(2)) + attempt(() => m.every2?.(2)) + attempt(() => m.find2?.(1)));
    for (const x of [7, 0.25, "x", null]) note(attempt(() => filled(C, n, f).kinds?.(x)));
    for (const name of changing) note(name + attempt(() => filled(C, n, f)[name]?.()));
    note(attempt(() => m.throwsAt?.(2)) + log.length);
  }
}
for (const C of [A, Named, Other]) askAll(C);
for (const C of [V, I]) for (let round = 0; round < 40; round++) { const m = new C(round & 7); for (let i = 0; i < m.length; i++) m[i] = i - 1.5; note(ask(m, ["folded", "each", "some2", "find2", "mapped", "filtered", "max"]) + attempt(() => m.dot(new C([2, 3, 4]))) + attempt(() => m.dot([1, 2])) + attempt(() => m.dot({ 0: 5, 1: 6 })) + attempt(() => m.dot(null)) + attempt(() => m.add?.(m)) + attempt(() => m.mixed?.(0.5)) + attempt(() => m.dot("ab"))); }
const holey = new A(5); holey[1] = 1; holey[4] = 4; note(ask(holey, onA)); const four = filled(A, 4, (i) => i);
Object.defineProperty(A.prototype, "2", { get() { return 9; }, configurable: true }); note(ask(holey, onA) + ask(four, onA)); delete A.prototype[2];
note(ask(new Named(5), onA));
let met = 0; const turning = filled(A, 8, (i) => i + 0.5);
note(one(turning.reduce((s, v, i) => { if (i === 3) { delete turning[5]; A.prototype[5] = 100; } return s + v; }, 0))); delete A.prototype[5];
const late = filled(A, 8, (i) => i); A.prototype.forEach = function (f) { met++; return Array.prototype.forEach.call(this, f); }; note(ask(late, ["each", "positions"]) + met); delete A.prototype.forEach; note(ask(late, ["each"]) + met);
const own = filled(A, 6, (i) => i); own.reduce = () => "own"; note(ask(own, ["folded", "mean"])); delete own.reduce; note(ask(own, ["folded", "mean"]));
const moved = filled(A, 6, (i) => i); Object.setPrototypeOf(moved, Other.prototype); note(one(A.prototype.each.call(moved)) + attempt(() => moved.run()));
for (const x of [[1, 2, 3], "abc", { length: 2, 0: 1, 1: 2 }, new V([1, 2, 3]), null, 5, new Proxy(filled(A, 3, (i) => i), {}), arguments0(4, 5)]) for (const n of ["folded", "each", "chained", "positions"]) note(n + attempt(() => (Object.hasOwn(Object(x ?? {}), "concat") ? 0 : A.prototype[n].call(Object.assign(Object(x ?? {}), x && typeof x === "object" && !ArrayBuffer.isView(x) ? { forEach: Array.prototype.forEach, reduce: Array.prototype.reduce, map: Array.prototype.map } : {})))));
function arguments0() { return arguments; }
const frozen = Object.freeze(filled(A, 4, (i) => i)); note(ask(frozen, onA) + ask(frozen, changing));
const grown = new ArrayBuffer(16, { maxByteLength: 64 }); class G extends Uint8Array { sum() { let s = 0; this.forEach((v, i) => { if (i === 2) grown.resize(8); s += v; }); return s; } } const g = new G(grown); for (let i = 0; i < 16; i++) g[i] = i; note(attempt(() => g.sum()) + g.length);
const shared = new V(4); shared[1] = 3; structuredClone(shared.buffer, { transfer: [shared.buffer] }); note(ask(shared, ["folded", "each", "mapped"]) + shared.length);
for (const l of lines) console.log(l);
console.log(hash, log.length, met);
