// STATISTIC: CapturedArrayReadsHoisted >= 1
"use strict";
function make() { let list = [1, 2, 3]; return { total() { let s = ""; for (let i = 0; i < list.length; i++) s += list[i]; return s; }, set(v) { list = v; } }; }
const box = make();
function step(r) { if (r === 6) box.set("text"); if (r === 8) box.set({ length: 2, 0: "a", 1: "b" }); if (r === 10) box.set(new Float64Array([1.5, 2.5])); return box.total(); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
