// STATISTIC: CapturedArrayReadsHoisted >= 1
"use strict";
function make(early) { function total(n) { let s = 0; for (let i = 0; i < n; i++) s += list[i]; return s; } let said; try { said = total(early); } catch (e) { said = e.constructor.name; } let list = [1, 2, 3]; return said + ":" + total(3); }
function step(r) { return make(r & 3); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
