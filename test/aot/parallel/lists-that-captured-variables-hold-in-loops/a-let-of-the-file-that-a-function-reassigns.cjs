// STATISTIC: CapturedArrayReadsHoisted >= 1
"use strict";
let table = [1, 2, 3, 4];
function renew(r) { table = table.map((v) => (v + r) % 9); }
function total() { let s = 0; for (let i = 0; i < table.length; i++) s = s * 2 + table[i]; return s; }
function step(r) { if (r % 3 === 2) renew(r); return total(); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
