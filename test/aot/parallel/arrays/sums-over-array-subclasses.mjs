// Loops over this[i] in methods of classes that extend Array: lists of every kind, holes, inherited elements, accessors, lists that change in the middle, other receivers.
const log = []; let hash = 0; const lines = [];
function one(v) { return Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "[" + (Array.isArray(v) ? v.length : "o") + "]" : typeof v === "symbol" ? "symbol" : String(v); }
function attempt(f) { try { return one(f()); } catch (e) { return e.constructor.name; } }
function note(s, show = true) { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; if (show && lines.length < 500) lines.push(s); }
const mixin = (S) => class Mixed extends S { total() { let t = 0; for (let i = 0; i < this.length; i++) t += this[i]; return t; } };
class M extends mixin(Array) {
  constructor(n, f) { super(); for (let i = 0; i < n; i++) this.push(f(i)); this.rows = n; }
  sum() { let s = 0; for (let i = 0; i < this.length; i++) s += this[i]; return s; }
  back() { let s = 0; for (let i = this.length - 1; i >= 0; i--) s -= this[i] * 2; return s; }
  past(n) { let s = 0; for (let i = 0; i < n; i++) s += this[i]; return s; }
  bits() { let s = 0; for (let i = 0; i < this.length; i++) s = (s << 1) ^ this[i]; return s; }
  most() { let s = -1e9; for (let i = 0; i < this.length; i++) if (this[i] > s) s = this[i]; return s; }
  steps() { let s = 0; for (let i = 1; i < this.length; i++) s += this[i] - this[i - 1]; return s; }
  norm() { let s = 0; for (let i = 0; i < this.length; i++) { const v = this[i]; s += v * v; } return Math.sqrt(s); }
  until(x) { let s = 0; for (let i = 0; i < this.length; i++) { s += this[i]; if (s > x) return i; } return -1; }
  dot(o) { let s = 0; for (let i = 0; i < this.length; i++) s += this[i] * o[i]; return s; }
  copy(o) { for (let i = 0; i < this.length; i++) o[i] = this[i]; return o.length; }
  running() { let s = 0; for (let i = 0; i < this.length; i++) { s += this[i]; this[i] = s; } return s; }
  nest() { let s = 0; for (let k = 0; k < 3; k++) for (let i = 0; i < this.length; i++) s += this[i] * k; return s; }
  shrink() { let s = 0; for (let i = 0; i < this.length; i++) { s += this[i]; if (i === 2) this.length = 4; } return s; }
  words() { let s = ""; for (let i = 0; i < this.length; i++) s += this[i]; return s.length; }
}
class Sub extends M { sum() { return super.sum() + 1; } }
const names = ["sum", "total", "back", "bits", "most", "steps", "norm", "nest", "words"];
const fills = [(i) => i, (i) => i + 0.5, (i) => i * 1e9, (i) => (i & 1 ? i : i / 4), (i) => "s" + i, (i) => (i === 4 ? undefined : i), (i) => (i === 5 ? NaN : i / 2), () => -0, (i) => (i === 2 ? null : i), (i) => BigInt(i), (i) => 2 ** 31 - 2 + i, (i) => ({ valueOf() { log.push(i); return i; } }), (i) => i % 3 === 0];
function all(m) { let s = ""; for (let round = 0; round < 12; round++) { s = ""; for (const name of names) s += attempt(() => m[name]()) + ","; s += attempt(() => m.past(7)) + "," + attempt(() => m.until(5)) + "," + attempt(() => m.dot([1, 2, 3, 4])) + "," + attempt(() => m.dot(m)); } return s; }
for (const f of fills) for (const n of [0, 1, 5, 9, 40]) for (const C of [M, Sub]) { const m = new C(n, f); note(all(m), n === 9); note(attempt(() => m.copy(new Array(3))) + attempt(() => m.copy(m)) + attempt(() => new C(n, f).running()) + attempt(() => new C(n, f).shrink()), n === 9); }
const changes = [(m) => { delete m[2]; }, (m) => { delete m[0]; m[0] = 3; }, (m) => { m.length += 3; }, (m) => { m[1] = "x"; }, (m) => { m[3] = undefined; }, (m) => { m[4] = NaN; }, (m) => { Object.defineProperty(m, 2, { get() { log.push("get"); return 7; }, configurable: true }); }, (m) => { Object.freeze(m); }, (m) => { Object.setPrototypeOf(m, Array.prototype); m.sum = M.prototype.sum; }, (m) => { m[20] = 5; }, (m) => { m.fill(0.25); m[7] = 1; }, (m) => { m[1] = { valueOf() { m[2] = "changed"; delete m[3]; m.length = 6; return 1; } }; }, (m) => { m.length = 0; m.push(1, 2); }, (m) => { m.sort(); m.reverse(); }];
for (const change of changes) for (const f of fills.slice(0, 4)) { const m = new M(8, f); note(all(m)); change(m); note(all(m)); note(all(m), false); }
M.prototype[2] = 1000; for (const f of fills.slice(0, 4)) { const m = new M(6, f); note(all(m)); delete m[2]; note(all(m)); note(all(new Sub(5, f))); } delete M.prototype[2];
Object.defineProperty(M.prototype, 1, { get() { log.push("above"); return 9; }, set(v) { log.push("set"); }, configurable: true });
for (const f of fills.slice(0, 4)) { const m = new M(6, f); note(all(m)); delete m[1]; note(all(m)); }
for (const other of [[1, 2, 3.5], [1, , 3], { length: 3, 0: 1, 2: 4 }, new Float64Array([1, 2, 0.5]), "123", new Proxy(new M(4, fills[0]), {})]) for (const name of names) note(name + attempt(() => M.prototype[name].call(other)));
console.log(lines.length, hash, log.length); console.log(lines.join("\n"));
