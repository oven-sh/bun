// STATISTIC: ModuleConstantReadsHoisted >= 1
// STATISTIC: StoredValuesNarrowedToInt32 >= 1
"use strict";
const table = []; const cache = [];
function fresh(n) { table.length = 0; cache.length = 0; for (let k = 0; k < n; k++) { table[k] = k + 1; cache[k] = 97 + k; } }

function run(from, n, by) { let result = from; for (let i = 0; i < n; i++) result = table[i] = result + table[i] + by; return result; }
function step(r) { fresh(8); return run(r, 8, r < 6 ? 10 : 1000000000) + JSON.stringify(table); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
