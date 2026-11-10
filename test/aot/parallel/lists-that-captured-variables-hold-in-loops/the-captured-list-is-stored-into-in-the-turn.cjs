// STATISTIC: CapturedListsReadInFrontOfLoops >= 1
"use strict";
function make() { let list = [0, 0, 0, 0, 0, 0]; return { bump(by) { for (let i = 0; i < list.length; i++) list[i] = (list[i] + by + i) | 0; return list.join(); }, swap() { list = list.slice().reverse(); } }; }
const box = make();
function step(r) { if (r % 5 === 4) box.swap(); return box.bump(r); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
