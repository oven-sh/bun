// STATISTIC: UndoableStoresOfElementWords >= 2
// Stores of int32s into holes in iterations that read, count or fail behind them: the hole comes back where the iteration is undone.
"use strict";
const own = a => { let s = a.length + ":"; for (let k = 0; k < a.length; k++) s += Object.prototype.hasOwnProperty.call(a, k) ? a[k] + "," : "_,"; return s; };
const attempt = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const given = new Map();
given.set("numbers", [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]); given.set("fraction", [3, 1, 4, 0.5, 5]); given.set("string", [1, 2, 3, "four", 5]); given.set("hole", [1, 2, , 4, 5]); given.set("large", [1, 2 ** 30, 2 ** 30, 2 ** 30, 5]); given.set("zero", [1, 2, -0, 4]);
function fibonacci(n, limit) { const m = new Array(n + 1); m[0] = 0; m[1] = 1; for (let i = 2; i <= n; i++) { m[i] = m[i - 1] + m[i - 2]; if (m[i] > limit) m[i] -= limit; } return own(m); }
function pairs(n) { const m = new Array(n + 1), c = new Array(n + 1); m[0] = 0; c[0] = 1; for (let i = 1; i <= n; i++) { m[i] = m[i - 1] + 1; c[i] = c[i - 1] * 7; m[i] += c[i] & 1; } return own(m) + own(c); }
function sums(w) { const n = w.length; const p = new Array(n + 1), q = new Array(n + 1); p[0] = 0; q[0] = 0; for (let i = 0; i < n; i++) { q[i + 1] = q[i] + 1; p[i + 1] = p[i] + w[i]; if (q[i + 1] > 3) q[i + 1]--; } return own(p) + own(q); }
function subsequence(a, b) { const m = a.length, n = b.length; const t = new Array(m + 1); for (let i = 0; i <= m; i++) { t[i] = new Array(n + 1); t[i][0] = 0; } for (let j = 0; j <= n; j++) t[0][j] = 0; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) { if (a[i - 1] === b[j - 1]) t[i][j] = t[i - 1][j - 1] + 1; else t[i][j] = t[i - 1][j] > t[i][j - 1] ? t[i - 1][j] : t[i][j - 1]; } return t.map(own).join(" "); }
function distance(a, b) { const m = a.length, n = b.length; let previous = new Array(n + 1); for (let j = 0; j <= n; j++) previous[j] = j; for (let i = 1; i <= m; i++) { const row = new Array(n + 1); row[0] = i; for (let j = 1; j <= n; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = row; } return own(previous); }
function counts(text) { const c = new Array(16); for (let i = 0; i < 16; i++) c[i] = 0; for (let i = 0; i < text.length; i++) { const k = text.charCodeAt(i) & 15; c[k]++; if (c[k] > 2) c[0]++; } return own(c); }
for (let round = 0; round < 3; round++) {
  console.log(fibonacci(12 + round, 1e6), fibonacci(60, 1e6), fibonacci(60, 1e300), fibonacci(50, 2 ** 31));
  console.log(pairs(8), pairs(14), pairs(30));
  for (const name of given.keys()) console.log(name, sums(given.get(name)));
  console.log(subsequence("holes", "shoelace"), distance("kitten", "sitting" + round), distance("", "ab"), counts("a table of characters"));
}
