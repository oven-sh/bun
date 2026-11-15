// Classes that extend classes of views: elements, lengths, accessors and iterations in their methods, and what changes in the middle.
const lines = []; let hash = 0;
function one(v) { return typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : v && typeof v === "object" ? (Array.isArray(v) || ArrayBuffer.isView(v) ? "[" + Array.from(v, one).join() + "]" : "{}") : String(v); }
function attempt(f) { try { return one(f()); } catch (e) { return e.constructor.name; } }
function note(s) { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; if (lines.length < 400) lines.push(s); }
const define = (Base) => class M extends Base {
  sum() { let s = 0; for (let i = 0; i < this.length; i++) s += Number(this[i]); return s; }
  scale(x) { for (let i = 0; i < this.length; i++) this[i] *= x; return this; }
  fillAll(x) { for (let i = 0; i < this.length; i++) this[i] = x; return this.length; }
  past() { let s = ""; for (let i = -1; i < this.length + 2; i++) s += this[i] + ","; return s; }
  steps() { let s = ""; for (const v of this) s += v + ";"; return s; }
  pairs() { let s = ""; for (const [i, v] of this.entries()) s += i + ":" + v + " "; return s; }
  dot(o) { let s = 0; for (let i = 0; i < this.length; i++) s += Number(this[i]) * Number(o[i]); return s; }
  get count() { return this.length; }
  get last() { return this[this.length - 1]; }
  set first(v) { this[0] = v; }
  byCount() { let s = 0; for (let i = 0; i < this.count; i++) s += Number(this[i]); return s; }
  cell(i, j) { return this[i * 2 + j]; }
  put(i, j, v) { this[i * 2 + j] = v; }
  turn() { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) this.put(i, j, this.cell(j, i)); return this.cell(0, 1); }
  bytes() { return this.byteLength + "/" + this.byteOffset + "/" + this.BYTES_PER_ELEMENT; }
  folded() { return this.reduce((a, b) => a + Number(b), 0); }
  each() { let s = 0; this.forEach((v, i) => { s += Number(v) * i; }); return s; }
  names() { return [this["1"], this[1.5], this["-1"], this["-0"], 1 in this, 99 in this]; }
  all() { return [...this].length + String(this.subarray(1).length) + this.slice(0, 2).length; }
};
const names = ["sum", "past", "steps", "pairs", "byCount", "turn", "bytes", "folded", "each", "names", "all"];
function every(m) { let s = ""; for (let round = 0; round < 6; round++) { s = ""; for (const n of names) s += n + attempt(() => m[n]()) + "|"; s += attempt(() => m.dot(m)) + attempt(() => m.dot([1, 2, 3])) + attempt(() => m.last) + attempt(() => m.count); } return s; }
class F64 extends Float64Array { sum() { let s = 0; for (let i = 0; i < this.length; i++) s += this[i]; return s; } scale(x) { for (let i = 0; i < this.length; i++) this[i] *= x; return this; } steps() { let s = 0; for (const v of this) s += v; return s; } get count() { return this.length; } byCount() { let s = 0; for (let i = 0; i < this.count; i++) s += this[i]; return s; } at2(i) { return this[i]; } }
class I32 extends Int32Array { constructor(n) { super(n); this.tag = n; } sum() { let s = 0; for (let i = 0; i < this.length; i++) s = (s + this[i]) | 0; return s; } }
class U8 extends Uint8Array { hash() { let h = 7; for (let i = 0; i < this.length; i++) h = (h * 31 + this[i]) | 0; return h; } }
function plain(m, times) { let s = 0; for (let i = 0; i < times; i++) { s += m.sum() + m.steps() + m.byCount() + m.at2(i & 3); m.scale(i & 1 ? 2 : 0.5); } return s; }
{ const m = new F64(9); for (let i = 0; i < 9; i++) m[i] = i + 0.5; note(one(plain(m, 40))); note(one(plain(m, 41))); const k = new I32(6); for (let i = 0; i < 6; i++) k[i] = i * 2 ** 29; let s = 0; for (let i = 0; i < 30; i++) s = (s + k.sum()) | 0; note(s + "," + k.tag); const u = U8.from([1, 2, 300, 4]); for (let i = 0; i < 30; i++) s ^= u.hash(); note(String(s)); }
for (const Base of [Float64Array, Float32Array, Int32Array, Uint32Array, Int16Array, Uint8Array, Uint8ClampedArray, BigInt64Array]) {
  const M = define(Base), value = (i) => (Base === BigInt64Array ? BigInt(i * 3) : i * 1.25);
  const made = (n) => { const m = new M(n); for (let i = 0; i < n; i++) m[i] = value(i); return m; };
  note(Base.name + every(made(5))); note(every(made(0))); note(every(new M([1, 2].map((v) => value(v)))));
  const shared = new M(new SharedArrayBuffer(32)), resizable = new ArrayBuffer(32, { maxByteLength: 64 });
  shared[0] = value(3); note(every(shared));
  const follows = new M(resizable); follows[1] = value(2); note(every(follows)); resizable.resize(64); note(every(follows)); resizable.resize(16); note(every(follows)); resizable.resize(0); note(every(follows));
  const gone = made(4); note(every(gone)); structuredClone(gone.buffer, { transfer: [gone.buffer] }); note(every(gone));
  const m = made(6);
  for (const change of [() => { m.extra = 1; }, () => { Object.defineProperty(m, "length", { value: 2, configurable: true }); }, () => { delete m.length; }, () => { Object.preventExtensions(m); }]) { attempt(change); note(every(m)); }
  const k = made(4); note(every(k)); k[Symbol.iterator] = function* () { yield 9; }; note(every(k)); Object.defineProperty(k, "count", { value: 1, configurable: true }); note(every(k)); Object.defineProperty(k, "cell", { value: () => 4 }); note(every(k));
  const p = made(3); note(every(p)); Object.setPrototypeOf(p, Base.prototype); note(attempt(() => M.prototype.sum.call(p)) + attempt(() => M.prototype.past.call(p)));
  Object.defineProperty(M.prototype, "length", { get() { return 2; }, configurable: true }); note(every(made(5))); delete M.prototype.length; note(every(made(5)));
  Object.defineProperty(M.prototype, "last", { get() { return "other"; }, configurable: true }); note(every(made(2)));
  M.prototype[Symbol.iterator] = function* () { yield 7; }; note(every(made(3))); M.prototype.cell = () => value(8); note(every(made(4)));
  class Sub extends M { sum() { return super.sum() + 1; } get count() { return 1; } } note(every(new Sub(3))); note(attempt(() => M.prototype.sum.call([1, 2, 3.5])) + attempt(() => M.prototype.past.call(new Base(2))) + attempt(() => M.prototype.steps.call(new Set([1]))) + attempt(() => M.prototype.sum.call({ length: 1, 0: 4 })));
}
console.log(lines.length, hash); console.log(lines.join("\n"));
