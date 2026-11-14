// Functions that are given instances of classes that extend Array and classes of views: loops, callbacks, patterns and spreads, the instances mixed with plain ones and changed in the middle.
const lines = []; let hash = 0;
function one(v) { return Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : v && typeof v === "object" ? "[" + Array.from(v, one).join() + "]" : String(v); }
function attempt(f) { try { return one(f()); } catch (e) { return e.constructor.name; } }
function note(s) { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; if (lines.length < 300) lines.push(s); }
class V extends Float64Array { get count() { return this.length; } get last() { return this[this.length - 1]; } at2(i) { return this[i]; } }
class I extends Int32Array {}
class A extends Array { get count() { return this.length; } get last() { return this[this.length - 1]; } set last(v) { this[this.length - 1] = v; } }
function sum(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
function sumV(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
function sumI(a) { let s = 0; for (let i = 0; i < a.length; i++) s = (s + a[i]) | 0; return s; }
function steps(a) { let s = 0; for (const v of a) s += v; return s; }
function stepsA(a) { let s = 0; for (const v of a) s += v; return s; }
function scale(a, x) { for (let i = 0; i < a.length; i++) a[i] *= x; return a; }
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function counted(a) { let s = 0; for (let i = 0; i < a.count; i++) s += a.at2 ? a.at2(i) : a[i]; return s; }
function ends(a) { let s = 0; for (let i = 0; i < 3; i++) s += a.last; return s; }
function folded(a) { return a.reduce((s, v) => s + v, 0); }
function foldedA(a) { return a.reduce((s, v) => s + v, 0); }
function each(a) { let s = 0; a.forEach((v, i) => { s += v * i; }); return s; }
function eachA(a) { let s = 0; a.forEach((v, i, all) => { s += v * i + all.length; }); return s; }
function found(a, x) { return a.some((v) => v === x) + "/" + a.every((v) => v !== x) + "/" + a.find((v) => v > x) + "/" + a.findIndex((v) => v > x); }
function foundA(a, x) { return a.some((v) => v === x) + "/" + a.every((v) => v !== x) + "/" + a.find((v) => v > x) + "/" + a.findIndex((v) => v > x); }
function mapped(a) { const r = a.map((v) => v * 2); return r.constructor.name + one(r) + a.filter((v) => v > 1).constructor.name; }
function pattern(a) { const [x, y, z = 7] = a; return one(x) + "," + y + "," + z; }
function patternA(a) { const [x, y, z = 7] = a; return one(x) + "," + y + "," + z; }
function spread(a) { return [0, ...a, 9].length + Math.max(...a); }
function spreadA(a) { return [0, ...a, 9].length + Math.max(...a); }
const all = [sum, sumV, sumI, steps, stepsA, (a) => dot(a, a), (a) => scale(a, 2), (a) => scale(a, 0.5), counted, ends, folded, foldedA, each, eachA, (a) => found(a, 2), (a) => foundA(a, 2), mapped, pattern, patternA, spread, spreadA];
function every(make) { for (let k = 0; k < all.length; k++) { let s; for (let i = 0; i < 9; i++) s = attempt(() => all[k](make(i))); note(k + s); } }
function repeat(f, a, n) { let s = 0; for (let i = 0; i < n; i++) s += f(a); return s; }
const v = new V(9), k = new I(7), m = new A(); for (let i = 0; i < 9; i++) { v[i] = i + 0.5; k[i % 7] = i * 2 ** 28; m.push(i * 1.5); }
for (const f of [sumV, steps, folded, each]) note(one(repeat(f, v, 50))); for (const f of [stepsA, foldedA, eachA]) note(one(repeat(f, m, 50))); note(one(repeat(sumI, k, 50))); note(one(repeat(sum, m, 40))); note(one(repeat(counted, v, 20)) + one(repeat(ends, m, 20)));
function runV(n) { let s = 0; for (let i = 0; i < n; i++) s = (s + sumV(v) + steps(v) + folded(v) + i) | 0; return s; }
function runI(n) { let s = 0; for (let i = 0; i < n; i++) s = (s + sumI(k) + i) | 0; return s; }
function runA(n) { let s = 0; for (let i = 0; i < n; i++) s = (s + stepsA(m) + foldedA(m) + eachA(m) + i) | 0; return s; }
function runDot(n) { let s = 0; for (let i = 0; i < n; i++) s += dot(v, v) + dot(m, m) + counted(v) + ends(m) + scale(v, i & 1 ? 2 : 0.5).length; return s; }
for (const n of [1, 2, 60]) note(one(runV(n)) + one(runI(n)) + one(runA(n)) + one(runDot(n)));
{ const order = []; for (let i = 0; i < 60; i++) { const a = i % 7 === 5 ? [1, 2] : i % 11 === 3 ? new Float64Array([4]) : i & 1 ? v : m; order.push(sum(a), steps(a), foldedA(a), patternA(a)); } note(order.join()); }
const filled = (C, n, f) => { const a = C === A ? new A() : new C(n); for (let i = 0; i < n; i++) a[i] = f(i); return a; };
for (const C of [A, V, I]) for (const f of [(i) => i, (i) => i + 0.5, (i) => (i === 1 ? NaN : i), () => -0]) for (const n of [0, 1, 4]) every(() => filled(C, n, f));
every(() => filled(A, 4, (i) => (i & 1 ? "x" + i : i))); every(() => { const a = filled(A, 5, (i) => i); delete a[1]; return a; }); every(() => { const a = filled(A, 3, (i) => i); a.length = 6; return a; }); every(() => Object.freeze(filled(A, 3, (i) => i + 0.5)));
every((i) => { const a = filled(A, 3, (j) => j); if (i > 4) a.reduce = () => "own"; return a; }); every((i) => { const a = filled(A, 3, (j) => j); if (i > 4) a[Symbol.iterator] = function* () { yield 5; }; return a; }); every((i) => { const a = filled(V, 3, (j) => j); if (i > 4) Object.defineProperty(a, "length", { value: 1 }); return a; }); every((i) => { const a = filled(V, 3, (j) => j); if (i > 4) a.forEach = () => "own"; return a; });
every((i) => (i > 4 ? new (class extends A { get last() { return "sub"; } reduce() { return "sub"; } })(1, 2, 3) : filled(A, 3, (j) => j))); every((i) => (i > 4 ? new (class extends V { get last() { return "sub"; } get length() { return 2; } })(3) : filled(V, 3, (j) => j)));
every(() => new V(new ArrayBuffer(24, { maxByteLength: 64 }))); every(() => new V(new SharedArrayBuffer(16))); { let i = 0; every(() => { const b = new ArrayBuffer(24, { maxByteLength: 64 }), a = new V(b); b.resize(8 * (i++ % 5)); return a; }); } every(() => { const a = filled(V, 3, (j) => j); structuredClone(a.buffer, { transfer: [a.buffer] }); return a; });
A.prototype[1] = 100; every(() => { const a = filled(A, 4, (i) => i); delete a[1]; return a; }); delete A.prototype[1]; Object.defineProperty(A.prototype, "last", { get() { return "late"; }, configurable: true }); every(() => filled(A, 3, (i) => i)); A.prototype.forEach = () => "late"; every(() => filled(A, 3, (i) => i));
V.prototype.reduce = () => "late"; every(() => filled(V, 3, (i) => i)); Object.defineProperty(V.prototype, "length", { get() { return 1; }, configurable: true }); every(() => filled(V, 3, (i) => i)); V.prototype[Symbol.iterator] = function* () { yield 3; }; every(() => filled(V, 3, (i) => i));
console.log(lines.length, hash); console.log(lines.join("\n"));
