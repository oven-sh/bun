// STATISTIC: ModuleConstantReadsHoisted >= 1
// STATISTIC: StoredValuesNarrowedToInt32 >= 1
"use strict";
const table = []; for (let k = 0; k < 8; k++) table[k] = k + 1; const again = table;
function shift(n) { let s = 0; for (let i = 0; i + 1 < n; i++) { again[i + 1] = table[i] + 1; s = (s * 7 + table[i + 1]) % 1000003; } return s; }
function step(r) { table[0] = r; return shift(8) + JSON.stringify(table); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
