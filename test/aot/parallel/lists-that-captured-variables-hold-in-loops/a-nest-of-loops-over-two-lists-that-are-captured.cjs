// STATISTIC: CapturedArrayReadsHoisted >= 1
"use strict";
function make() { let rows = [1, 2, 3], columns = [4, 5, 6, 7]; return { all() { let s = 0; for (let i = 0; i < rows.length; i++) for (let j = 0; j < columns.length; j++) s += rows[i] * columns[j]; return s; }, grow(v) { rows = rows.concat([v]); columns = columns.slice(1).concat([v]); } }; }
const box = make();
function step(r) { if (r & 1) box.grow(r); return box.all(); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
