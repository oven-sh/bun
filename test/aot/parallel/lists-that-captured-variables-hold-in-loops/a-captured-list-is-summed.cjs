// STATISTIC: CapturedListsReadInFrontOfLoops >= 1
"use strict";
function make() { let list = []; return { add(v) { list.push(v); }, total() { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }, reset() { list = []; } }; }
const box = make();
function step(r) { if (r === 7) box.reset(); box.add(r * 3); return box.total(); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
