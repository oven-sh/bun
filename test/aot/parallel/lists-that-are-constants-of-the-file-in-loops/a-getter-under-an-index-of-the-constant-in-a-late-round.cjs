// STATISTIC: ModuleConstantReadsHoisted >= 1
"use strict";
const table = []; const cache = [];
function fresh(n) { table.length = 0; cache.length = 0; for (let k = 0; k < n; k++) { table[k] = k + 1; cache[k] = 97 + k; } }

let seen = 0;
function walk(n) { let s = 0; for (let i = 0; i < n; i++) { s += table[i]; table[i] = s & 15; } return s; }
fresh(5);
function step(r) { if (r === 7) Object.defineProperty(table, 2, { get() { seen++; return 30; }, set(v) { seen += 100; }, configurable: true }); return walk(5) + ":" + seen; }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
