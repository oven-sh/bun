// STATISTIC: StoresUnderAnyKeyThatRaiseTheLengthInLine >= 1
"use strict";
const ids = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12,13]");

function fresh() { return [1, 2, 3]; }
function put(list, key, v) { list[key] = v; return list.join(); }
function step(r) { const a = fresh(), b = fresh(); return put(a, ids[3 + (r & 1)], r) + "|" + b.join() + "|" + put(b, ids[r & 3], -r); }
const out = []; for (let r = 0; r < 14; r++) out.push(String(step(r))); console.log(out.join(" "));
