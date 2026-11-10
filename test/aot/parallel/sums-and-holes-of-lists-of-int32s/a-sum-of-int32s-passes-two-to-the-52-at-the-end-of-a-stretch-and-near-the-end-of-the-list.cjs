// STATISTIC: SumsOfIntegersInTurnsLaidOut >= 1
"use strict";
function sum(l, from) { let s = from; for (let i = 0; i < l.length; i++) s += l[i]; return s; }
const out = [];
for (const n of [1048576, 1048577, 1048583, 1048584, 1048585, 2097152, 2097159, 2097160, 2100003, 3000001]) {
  const l = []; for (let k = 0; k < n; k++) l.push(2147483647 - (k & 3));
  out.push(n + ":" + sum(l, 0) + ":" + sum(l, 4503599627370000) + ":" + sum(l, -4503599627370496) + ":" + sum(l, 0.5));
}
console.log(out.join(" "));
