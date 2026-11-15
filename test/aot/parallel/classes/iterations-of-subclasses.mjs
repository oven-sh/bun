// Classes that extend Array, Map and Set: for-of, patterns, spreads, stores and callbacks in their methods, and what changes in the middle.
const lines = [], log = []; let hash = 0;
function one(v) { return Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + Array.from(v, one).join() + "]" : v && typeof v === "object" ? "{}" : typeof v === "symbol" ? "symbol" : String(v); }
function attempt(f) { try { return one(f()); } catch (e) { return e.constructor.name; } }
function note(s) { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; if (lines.length < 400) lines.push(s); }
class A extends Array {
  steps() { let s = ""; for (const v of this) s += one(v) + ","; return s; }
  sum() { let s = 0; for (const v of this) s += v; return s; }
  pairs() { let s = ""; for (const [i, v] of this.entries()) s += i + one(v); return s; }
  keysOf() { let s = 0; for (const i of this.keys()) s += i; return s; }
  scale(x) { for (let i = 0; i < this.length; i++) this[i] *= x; return this.length; }
  copyOver(x) { for (let i = 0; i < this.length; i++) this[i] = x; return this.length; }
  shift2() { for (let i = 1; i < this.length; i++) this[i - 1] = this[i]; return this.length; }
  folded() { return this.reduce((a, b) => a + b, 0); }
  first() { return this.length ? this.reduce((a, b) => a) : "none"; }
  each() { let s = 0; this.forEach((v) => { s += v; }); return s; }
  has2() { return this.some((v) => v === 2) + "" + this.every((v) => v !== 2) + this.findIndex((v) => v > 1) + one(this.find((v) => v > 1)); }
  made() { const r = this.map((v) => v); return r.constructor.name + r.length + this.filter((v) => v > 1).constructor.name; }
  list() { return [...this, 1, ...this].length; }
  parts() { const [a, b, , c = 5, ...d] = this; return [a, b, c, d.length, d.constructor === Array]; }
  get last() { return this[this.length - 1]; }
  inside() { let s = 0; for (let i = 0; i < this.length + 2; i++) if (i in this) s += i; return s; }
  grow() { let n = 0; for (const v of this) { if (n++ === 1) this.push(8); if (n > 9) break; } return n; }
  cut() { let n = 0; for (const v of this) { if (n++ === 1) this.length = 2; } return n; }
  until(x) { for (const v of this) if (v === x) return "found"; return "none"; }
}
const onA = ["steps", "sum", "pairs", "keysOf", "folded", "first", "each", "has2", "made", "list", "parts", "inside", "shift2"];
function everyA(m) { let s = ""; for (let round = 0; round < 5; round++) { s = ""; for (const n of onA) s += n + attempt(() => m[n]()) + "|"; s += attempt(() => m.last) + attempt(() => m.until(2)) + attempt(() => m.scale(round & 1 ? 2 : 0.5)); } return s; }
const fills = [(i) => i, (i) => i + 0.5, (i) => "s" + i, (i) => (i === 2 ? undefined : i), (i) => (i === 2 ? NaN : i), (i) => -0, (i) => 2 ** 31 - 2 + i, (i) => ({ valueOf() { log.push(i); return i; } }), (i) => (i & 1 ? i : i / 4), (i) => [i, i + 1]];
const filled = (C, n, f) => { const m = new C(); for (let i = 0; i < n; i++) m.push(f(i)); return m; };
for (const f of fills) for (const n of [0, 1, 4, 9]) { const m = filled(A, n, f); note(everyA(m)); note(attempt(() => filled(A, n, f).grow()) + attempt(() => filled(A, n, f).cut()) + attempt(() => m.copyOver(f(1)))); }
for (const change of [(m) => { delete m[2]; }, (m) => { m.length = 9; }, (m) => { m[1] = "x"; }, (m) => { m[12] = 1; }, (m) => { Object.freeze(m); }, (m) => { Object.seal(m); }, (m) => { m["-1"] = 4; m["1.5"] = 5; }, (m) => { Object.defineProperty(m, 1, { get() { log.push("get"); return 7; }, configurable: true }); }, (m) => { Object.defineProperty(m, "length", { writable: false }); }, (m) => { m[Symbol.iterator] = function* () { yield 4; }; }, (m) => { m.entries = () => [[0, 1]]; m.forEach = () => log.push("each"); }, (m) => { Object.setPrototypeOf(m, class extends A { steps() { return "other"; } }.prototype); }, (m) => { m.constructor = { [Symbol.species]: function () { return {}; } }; }, (m) => { m.sort().reverse(); }, (m) => { m.length = 0; m.push([1], [2]); }])
  for (const f of [fills[0], fills[1], fills[8]]) { const m = filled(A, 6, f); note(everyA(m)); attempt(() => change(m)); note(everyA(m)); note(everyA(m)); }
A.prototype[2] = 1000; for (const f of fills.slice(0, 3)) { const m = filled(A, 5, f); note(everyA(m)); delete m[2]; note(everyA(m)); note(everyA(m)); } delete A.prototype[2];
Object.defineProperty(A.prototype, 1, { get() { log.push("above"); return 9; }, set(v) { log.push("set"); }, configurable: true });
for (const f of fills.slice(0, 2)) { const m = filled(A, 5, f); note(everyA(m)); delete m[1]; note(everyA(m)); } delete A.prototype[1];
A.prototype["-1"] = 3; note(everyA(filled(A, 3, fills[0]))); const iterator = A.prototype[Symbol.iterator];
A.prototype[Symbol.iterator] = function* () { yield 6; yield 5; }; note(everyA(filled(A, 3, fills[0]))); delete A.prototype[Symbol.iterator]; note(everyA(filled(A, 3, fills[1])) + (iterator === Array.prototype.values));
for (const other of [[1, 2, 3.5], [1, , 3], "12", new Set([1, 2]), new Float64Array([1, 0.5]), { length: 1, 0: 2, [Symbol.iterator]: Array.prototype.values }]) for (const n of onA) note(n + attempt(() => A.prototype[n].call(other)));
class T extends Map {
  pairs() { let s = ""; for (const [k, v] of this) s += k + one(v) + ","; return s; }
  total() { let s = 0; for (const v of this.values()) s += v; return s; }
  names() { let s = ""; for (const k of this.keys()) s += k; return s; }
  listed() { let s = ""; for (const e of this.entries()) s += e.length + one(e[1]); return s; }
  each() { let s = 0; this.forEach((v) => { s += v; }); return s; }
  thin() { let n = 0; for (const [k] of this) { n++; this.delete(k); if (n === 2) this.set("new" + n, 3); if (n > 9) break; } return n + "/" + this.size; }
  spread() { return [...this].length + this.size; }
  pattern() { const [a, [b, c] = []] = this; return one(a) + b + c; }
  look(k) { if (!this.has(k)) this.set(k, 0); return this.get(k); }
}
class S extends Set { pairs() { let s = ""; for (const v of this) s += v + ","; return s; } total() { let s = 0; for (const v of this.values()) s += v; return s; } names() { let s = ""; for (const k of this.keys()) s += k; return s; } listed() { let s = ""; for (const e of this.entries()) s += e.length; return s; } each() { let s = 0; this.forEach((v) => { s += v; }); return s; } thin() { let n = 0; for (const k of this) { n++; this.delete(k); if (n === 2) this.add(50); if (n > 9) break; } return n + "/" + this.size; } spread() { return [...this].length + this.size; } pattern() { const [a, b] = this; return one(a) + b; } look(k) { return this.has(k); } }
const onT = ["pairs", "total", "names", "listed", "each", "spread", "pattern"];
function everyT(m) { let s = ""; for (let round = 0; round < 5; round++) { s = ""; for (const n of onT) s += n + attempt(() => m[n]()) + "|"; s += attempt(() => m.look(1)) + attempt(() => m.look(77)); } return s; }
for (const C of [T, S]) {
  const filledT = (n) => { const m = new C(); for (let i = 0; i < n; i++) C === T ? m.set(i, i * 2) : m.add(i); return m; };
  for (const n of [0, 1, 3, 40]) { note(everyT(filledT(n))); note(filledT(n).thin()); }
  for (const change of [(m) => { m.extra = 1; }, (m) => { m.clear(); }, (m) => { m[Symbol.iterator] = function* () { yield [1, 2]; }; }, (m) => { m.values = () => [5]; }, (m) => { Object.setPrototypeOf(m, (C === T ? Map : Set).prototype); for (const n of onT.concat("look")) m[n] = C.prototype[n]; }, (m) => { m.delete(0); m.delete(1); }, (m) => { m.forEach = () => log.push("own"); }]) { const m = filledT(4); note(everyT(m)); attempt(() => change(m)); note(everyT(m)); note(everyT(m)); }
  C.prototype[Symbol.iterator] = function* () { yield [3, 4]; }; note(everyT(filledT(3))); delete C.prototype[Symbol.iterator]; C.prototype.values = function* () { yield 1; }; note(everyT(filledT(3))); delete C.prototype.values; note(everyT(filledT(3)));
  class Sub extends C { *[Symbol.iterator]() { yield [8, 9]; } } note(everyT(new Sub()));
  for (const other of [new Map([[1, 2]]), new Set([3]), [[1, 2]]]) for (const n of onT) note(n + attempt(() => C.prototype[n].call(other)));
}
console.log(lines.length, hash, log.length); console.log(lines.join("\n"));
