// STATISTIC: CapturedListsReadInFrontOfLoops >= 1
"use strict";
function make() { let list = [1, 2, 3, 4]; return { each: function* () { for (let i = 0; i < list.length; i++) yield list[i]; }, set(l) { list = l; } }; }
function step(r) { const box = make(); const it = box.each(); const got = [it.next().value]; if (r & 1) box.set([9, 8, 7, 6, 5].slice(0, 2 + (r >> 1) % 4)); for (const v of it) got.push(v); return got.join(""); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
