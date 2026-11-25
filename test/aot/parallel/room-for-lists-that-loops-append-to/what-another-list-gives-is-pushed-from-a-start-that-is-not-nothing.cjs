// STATISTIC: ClampedCapacitiesReserved >= 1
"use strict";
function take(l, from, to) { const got = [from]; for (let j = from; j < to; j++) got.push(l[j] + 1); return got; }
const l = []; for (let k = 0; k < 40; k++) l.push(k * k);
function step(r) { const g = take(l, r, r * 4); return g.length + ":" + String(g[g.length - 1]) + ":" + String(g[1]); }
const out = []; for (let r = 0; r < 12; r++) out.push(String(step(r))); console.log(out.join(" "));
