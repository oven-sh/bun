// COUNT: operation:operationAOTFillSiteAnswers <= 40
"use strict";
var step = 3;
const held = Object.create({});
Object.defineProperty(held, "rate", { enumerable: true, configurable: true, get: function () { return step; } });
function total(turn) {
  let sum = turn & 1;
  for (let index = 0; index < 100; index++)
    sum = (sum + held.rate) | 0;
  return sum >>> 0;
}
let all = 0;
for (let turn = 0; turn < 300; turn++) {
  if (turn === 150)
    step = 5;
  all = (all + total(turn)) % 1000003;
}
console.log(all);
