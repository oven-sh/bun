"use strict";
const D = JSON.parse("[0,1,2,3,4,5,6,7]");
const made = D.map(v => v % 3 === 0 ? new Float64Array([v]) : v % 3 === 1 ? [v, v] : "t" + v);
function lengths(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].length; return s; }
let all = 0;
for (let t = 0; t < 40; t++) all += lengths(made);
console.log(all, made.map(v => typeof v).join());
