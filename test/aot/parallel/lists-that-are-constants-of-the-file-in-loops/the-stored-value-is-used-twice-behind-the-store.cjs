// STATISTIC: ModuleConstantReadsHoisted >= 1
"use strict";
const table = []; const cache = [];
function fresh(n) { table.length = 0; cache.length = 0; for (let k = 0; k < n; k++) { table[k] = k + 1; cache[k] = 97 + k; } }

const sums = []; for (let k = 0; k < 6; k++) sums[k] = 0;
function run(n, by) { let v = 1, t = 0; for (let i = 0; i < n; i++) { v = table[i] = v * by + table[i]; sums[i] = v; t = (t + v) % 1000003; } return t; }
function step(r) { fresh(6); return run(6, r < 7 ? 2 : 70000) + JSON.stringify(table) + JSON.stringify(sums); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
