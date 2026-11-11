// None of these loops is given room: what is held is the answers.
"use strict";
function far(from, to) { const got = [0]; for (let j = from; j <= to; j++) got[j] = j; return got.length + ":" + Object.keys(got).length + ":" + (1 in got); }
function step(r) { return far(r * 3 + 1, r * 3 + 4); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
