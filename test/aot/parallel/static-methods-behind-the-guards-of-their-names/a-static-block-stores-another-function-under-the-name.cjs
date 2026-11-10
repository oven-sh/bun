"use strict";
const D = JSON.parse("[1,2,3]");
const out = [];
class Q { static twice(x) { return x * 2; } static { Q.twice = x => x * 6; } }
class R { static twice(x) { return x * 2; } static other = (R.twice = x => x * 8, 1); }
const qs = D.map(() => [new Q(), new R()]);
function sum(n) { let s = 0; for (let i = 0; i < n; i++) s += Q.twice(i) + R.twice(i); return s; }
out.push(sum(40), R.other, qs.length);
console.log(out.join(" "));
