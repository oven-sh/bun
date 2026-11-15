// STATISTIC: RowStoresMaybeAppending >= 1
// d[i] = [i], and a loop that stores d[i][j] from the length of the literals on; rows of other lengths and kinds come too.
"use strict";
const own = a => Array.isArray(a) ? a.length + "[" + Array.from(a, (v, k) => k in a ? own(v) : "_").join() + "]" : String(a);
const texts = new Map([["a", "kitten"], ["b", "sitting"], ["c", ""], ["d", "execution"]]);
function distance(a, b) { const m = a.length, n = b.length; const d = []; for (let i = 0; i <= m; i++) { d[i] = [i]; } for (let j = 0; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) { const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1; d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost); } return d[m][n]; }
function distanceBesides(a, b, at, row) { const m = a.length, n = b.length; const d = []; for (let i = 0; i <= m; i++) { d[i] = [i]; } for (let j = 0; j <= n; j++) d[0][j] = j; if (at >= 0) d[at] = row; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) { const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1; d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost); } return own(d); }
const rows = [() => [], () => [9, 9], () => new Array(6), () => Object.freeze([3]), () => Object.seal([3]), () => Object.preventExtensions([3, 4]), () => [0.5], () => ["s"], () => Object.defineProperty([2], 2, { get() { return 7; }, set() { }, configurable: true }), () => Object.defineProperty([2], "length", { writable: false }), () => null, () => "text", () => new Proxy([1], { }), () => new Float64Array(4), () => [2147483647], () => [-0], () => ({ 0: 5 })];
for (let round = 0; round < 3; round++) {
  for (const a of texts.keys()) for (const b of texts.keys()) console.log(a, b, distance(texts.get(a), texts.get(b)), distanceBesides(texts.get(a), texts.get(b), -1, null));
  for (let k = 0; k < rows.length; k++) for (const at of [0, 1, 3, 6]) { let r; try { r = distanceBesides(texts.get("a"), texts.get("b"), at, rows[k]()); } catch (e) { r = e.constructor.name; } console.log(k, at, r); }
}
