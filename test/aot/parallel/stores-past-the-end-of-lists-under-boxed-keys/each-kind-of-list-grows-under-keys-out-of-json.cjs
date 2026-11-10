// STATISTIC: StoresUnderAnyKeyThatRaiseTheLengthInLine >= 1
"use strict";
const ids = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12,13]");

const ints = [], fractions = [], mixed = [];
function put(list, key, v) { list[key] = v; return list.length; }
function step(r) { const k = ids[r]; return [put(ints, k, r * 2), put(fractions, k, r + 0.5), put(mixed, k, r & 1 ? "t" + r : { r })].join() + (r === 13 ? JSON.stringify([ints, fractions, mixed]) : ""); }
const out = []; for (let r = 0; r < 14; r++) out.push(String(step(r))); console.log(out.join(" "));
