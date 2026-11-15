// Loops that add a value nobody knows to elements, or hand it to Math; values and lists of every kind.
// STATISTIC: AddendsDistinguished >= 2
const said = []; let digest = 0, cases = 0, calls = 0;
function keep(text) { cases++; for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 89 === 1) said.push(text.slice(0, 150)); }
function show(x) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : Array.isArray(x) ? "[" + Array.from({ length: Math.min(x.length, 12) }, (_, i) => i in x ? show(x[i]) : "_").join() + "]#" + x.length : ArrayBuffer.isView(x) ? x.constructor.name + Array.from(x, y => show(y)).join() : typeof x; } catch (e) { return "!" + e.constructor.name; } }
const lists = [
  () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5], () => [0, 1, 2, 3, 4, 5, 6, 7], () => ["a", "b", "c", "d", "e", "f", "g", "h"], () => [1, "b", 2.5, null, undefined, true, { valueOf() { calls++; return 4; } }, 8],
  () => [1, , 3, , 5, 6, 7, 8], () => [2147483647, -2147483648, 2147483646, 1e10, -0, NaN, Infinity, 1], () => [], () => [1.5, 2.5], () => new Array(8).fill(0), () => new Float64Array([1.5, 2, 3, 4, 5, 6, 7, 8]), () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 255]),
  () => "letters", () => Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]), () => [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n], () => new Proxy([1, 2, 3, 4, 5, 6, 7, 8], {}),
];
let held = [];
const values = [
  () => 1.5, () => 3, () => 0, () => -0, () => NaN, () => Infinity, () => 2147483647, () => "s", () => "7", () => "", () => null, () => undefined, () => true, () => 5n, () => Symbol("k"), () => [], () => [4], () => ({}), () => ({ valueOf() { calls++; return 2; } }),
  () => ({ valueOf() { calls++; held[3] = "changed"; return 2; } }), () => ({ valueOf() { calls++; held.length = 2; return 2; } }), () => ({ valueOf() { throw new RangeError("no"); } }), () => ({ toString() { calls++; return "t"; } }), () => ({ [Symbol.toPrimitive](hint) { calls++; return hint === "default" ? 1 : 0.5; } }), () => new Date(5), () => new Number(6), () => new String("w"), () => () => 1,
];
let place = 0;
function tried(f, x, y, v, n) { if (place++ % 103) return; held = x; calls = 0; const c = { k: v, b: 5, w: 2 }; let answer; try { answer = show(f(x, y, c, n)); } catch (e) { answer = e.constructor.name; } keep(f.name + " " + n + " " + answer + show(x) + show(y) + calls); }
function greatest(x, y, c, n) { const k = c.k; for (let i = 0; i < n; i++) y[i] = Math.max(x[i], k); return y[1]; }
function least(x, y, c, n) { const k = c.k; let a = 9; for (let i = 0; i < n; i++) a = Math.min(a, x[i] + k); return a; }
function bounded(x, y, c, n) { const k = c.k, b = c.b; for (let i = 0; i < n; i++) y[i] = Math.min(Math.max(x[i], k), b); return y[0]; }
function sum(x, y, c, n) { const k = c.k; for (let i = 0; i < n; i++) y[i] = x[i] + k; return y[1]; }
function sumFirst(x, y, c, n) { const k = c.k; for (let i = 0; i < n; i++) y[i] = k + x[i]; return y[1]; }
function grown(x, y, c, n) { const k = c.k; for (let i = 0; i < n; i++) y[i] += k; return y[1]; }
function total(x, y, c, n) { const k = c.k; let s = 0; for (let i = 0; i < n; i++) s += x[i] + k; return s; }
function joined(x, y, c, n) { const k = c.k; let s = ""; for (let i = 0; i < n; i++) s += x[i] + k; return s; }
function relaxed(x, y, c, n) { const k = c.k; for (let i = 0; i < n; i++) y[i] = Math.max(y[i], x[i] + k); return y[1]; }
function sack(x, y, c, n) { const w = c.w, v = c.k, f = new Array(n + 4).fill(0); for (let j = n + 3; j >= w; j--) f[j] = Math.max(f[j], f[j - w] + v); return f.join(); }
function rounded(x, y, c, n) { const k = c.k; for (let i = 0; i < n; i++) y[i] = Math.floor(x[i] + k); return y[1]; }
function away(x, y, c, n) { const k = c.k; let s = 0; for (let i = 0; i < n; i++) s += Math.abs(k); return s + x.length; }
function some(x, y, c, n) { const k = c.k; for (let i = 0; i < n; i++) if (i & 1) y[i] = x[i] + k; return y[1]; }
function rows(x, y, c, n) { const k = c.k; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) x[i] = y[j] + k; return x[0]; }
for (const f of [greatest, least, bounded, sum, sumFirst, grown, total, joined, relaxed, sack, rounded, away, some, rows]) for (const a of lists) for (const b of [0, 1, 2, 3, 9]) for (const v of values) for (const n of [0, 1, 5, 8]) tried(f, a(), lists[b](), v(), n);
console.log(cases, digest); for (const x of said) console.log(x);
