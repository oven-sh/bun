// STATISTIC: ConstantsOfFilesReadInFrontOfLoops >= 1
"use strict";
const table = []; const cache = [];
function fresh(n) { table.length = 0; cache.length = 0; for (let k = 0; k < n; k++) { table[k] = k + 1; cache[k] = 97 + k; } }

function* each(n) { for (let i = 0; i < n; i++) yield table[i]; }
function step(r) { fresh(5); const it = each(5); const got = [it.next().value, it.next().value]; table[2] = r & 1 ? "c" : 2.5; if (r & 2) table.length = 4; for (const v of it) got.push(v); return got.join(); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
