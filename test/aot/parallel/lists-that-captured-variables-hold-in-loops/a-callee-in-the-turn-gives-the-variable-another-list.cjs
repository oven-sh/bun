// STATISTIC: CapturedArrayReadsHoisted >= 1
"use strict";
function make() { let list = [1, 2, 3, 4, 5, 6]; const other = [60, 50, 40, 30, 20, 10]; const first = list;
  function swap(i, r) { if (i === r % 7) list = list === first ? other : first; }
  return function total(r) { let s = 0; for (let i = 0; i < list.length; i++) { swap(i, r); s = s * 3 + list[i]; } return s; }; }
const total = make();
function step(r) { return total(r); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
