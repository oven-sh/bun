// STATISTIC: ConstantsOfFilesReadInFrontOfLoops >= 1
"use strict";
const table = []; const cache = [];
function fresh(n) { table.length = 0; cache.length = 0; for (let k = 0; k < n; k++) { table[k] = k + 1; cache[k] = 97 + k; } }

function cut(i, r) { if (i === r) table.length = 5; }
function sum(n, r) { let s = ""; for (let i = 0; i < n; i++) { cut(i, r); s += table[i] + ";"; } return s; }
function step(r) { fresh(8); return sum(8, r) + table.length; }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
