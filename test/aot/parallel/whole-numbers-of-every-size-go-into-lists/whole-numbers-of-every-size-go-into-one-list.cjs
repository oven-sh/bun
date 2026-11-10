// STATISTIC: WholeNumbersStoredOutOfLineAsTheyAre >= 1
"use strict";
const table = [];
function fill(from, n) { let i = 0, v = from; while (i < n) { table[i] = v; v = v * 2 + 1; i++; } return JSON.stringify(table); }
function step(r) { if (r === 6) table.length = 0; return fill([1, 3, 1073741823, 5, 4503599627370495, 7][r % 6], 4 + (r & 3)); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
