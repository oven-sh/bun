// STATISTIC: ConstantsOfFilesReadInFrontOfLoops >= 1
"use strict";
const table = []; const cache = [];
function fresh(n) { table.length = 0; cache.length = 0; for (let k = 0; k < n; k++) { table[k] = k + 1; cache[k] = 97 + k; } }

function inner(n, b) { let c = 0; for (let i = 0; i < n; i++) { if (cache[i] === b) c += table[i]; table[i] = (table[i] + c) & 31; } return c; }
function outer(m) { let t = 0; for (let j = 0; j < m; j++) t = t * 5 + inner(4 + (j & 3), 97 + j); return t; }
function step(r) { fresh(6); return outer(r) + JSON.stringify(table); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
