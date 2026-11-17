"use strict";
function scaled(factor) { return function (a, b) { return (a * factor + b) | 0; }; }
function crossed(a, b) { return (a ^ b) | 0; }
const twice = scaled(2);
const thrice = scaled(3);
let pick = crossed;
function total(t) { let s = t & 1; for (let i = 0; i < 12; i++) s = (s + pick(i, t)) | 0; return s; }
const out = [];
for (let t = 0; t < 9; t++) {
  if (t % 3 === 0) pick = twice;
  else if (t % 3 === 1) pick = thrice;
  else pick = crossed;
  out.push(total(t));
}
console.log(out.join(" "));
