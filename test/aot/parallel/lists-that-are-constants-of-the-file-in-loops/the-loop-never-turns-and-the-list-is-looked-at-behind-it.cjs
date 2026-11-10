// STATISTIC: ConstantsOfFilesReadInFrontOfLoops >= 1
"use strict";
const table = [];
function none(n) { let s = 0; for (let i = 0; i < n; i++) s += table[i]; return s + ":" + table.length + Array.isArray(table); }
function step(r) { return none(r < 6 ? 0 : r - 5); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
