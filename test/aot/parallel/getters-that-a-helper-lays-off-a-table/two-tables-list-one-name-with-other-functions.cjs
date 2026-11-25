"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true, configurable: true });
};
var one = {}, two = {};
__export(one, { pick: () => 1, alone: () => 10 }); __export(two, { pick: () => 2 });
const said = [];
function run(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { sum = sum + one.pick + two.pick * 3 + one.alone | 0; } return sum; }
console.log(run(40));
