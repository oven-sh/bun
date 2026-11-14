"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true, configurable: true });
};
const shared = () => kept; let kept = 5;
var one = {}, two = {};
__export(one, { value: shared }); __export(two, { value: shared, other: () => 9 });
const both = [one, two];
const said = [];
function run(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { sum = sum + both[turn & 1].value + two.other | 0; if (turn === 9) kept = 6; } return sum; }
console.log(run(40));
