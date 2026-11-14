// STATISTIC: StringsAndArraysDistinguished >= 2
// Values that are strings or arrays, which loops read under indexes and compare with each other.
"use strict";
const given = new Map([["kitten", "kitten"], ["sitting", "sitting"], ["letters", ["s", "i", "t"]], ["numbers", [1, 2, 3, 2]], ["holes", ["s", , "t"]], ["empty", ""], ["none", []], ["wide", "中😀s"], ["number", 7], ["nothing", undefined]]);
function distance(a, b) { const m = a.length, n = b.length; let previous = new Array(n + 1); for (let j = 0; j <= n; j++) previous[j] = j; for (let i = 1; i <= m; i++) { const row = new Array(n + 1); row[0] = i; for (let j = 1; j <= n; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = row; } return previous[n]; }
function subsequence(a, b) { const m = a.length, n = b.length; const t = new Array(m + 1); for (let i = 0; i <= m; i++) { t[i] = new Array(n + 1); t[i][0] = 0; } for (let j = 0; j <= n; j++) t[0][j] = 0; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) { if (a[i - 1] === b[j - 1]) t[i][j] = t[i - 1][j - 1] + 1; else t[i][j] = t[i - 1][j] > t[i][j - 1] ? t[i - 1][j] : t[i][j - 1]; } return t[m][n]; }
function common(a, b) { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k; }
function past(a, b) { let s = ""; for (let i = 0; i < 9; i++) s += a[i] === b[i] ? "=" : a[i] < b[i] ? "<" : "?"; return s; }
const attempt = f => { try { return f(); } catch (e) { return e.constructor.name; } };
for (let round = 0; round < 3; round++) for (const x of given.keys()) for (const y of given.keys()) console.log(x, y, attempt(() => distance(given.get(x), given.get(y))), attempt(() => subsequence(given.get(x), given.get(y))), attempt(() => common(given.get(x), given.get(y))), attempt(() => past(given.get(x), given.get(y))));
