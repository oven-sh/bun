// STATISTIC: SizedArraysOfWholeNumbers >= 2
// Tables of Math.min, Math.max and Math.abs of numbers without fractions hold int32s until something else comes.
"use strict";
const show = v => Object.is(v, -0) ? "-0" : String(v);
const own = a => a.length + ":" + Array.from(a, show).join();
const texts = new Map([["a", "kitten"], ["b", "sitting"], ["c", ""], ["d", "intention"], ["e", "execution"]]);
function distance(a, b) { const m = a.length, n = b.length; let previous = new Array(n + 1); for (let j = 0; j <= n; j++) previous[j] = j; for (let i = 1; i <= m; i++) { const row = new Array(n + 1); row[0] = i; for (let j = 1; j <= n; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1)); previous = row; } return own(previous); }
for (let round = 0; round < 3; round++) for (const a of texts.keys()) for (const b of texts.keys()) console.log(a, b, distance(texts.get(a), texts.get(b)));
