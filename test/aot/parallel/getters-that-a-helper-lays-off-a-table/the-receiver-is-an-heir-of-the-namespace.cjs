"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true, configurable: true });
};
var space = {};
__export(space, { low: () => low, add: () => add, count: () => count });
function add(a, b) { return a + b | 0; }
function low(a) { return a & 15; }
let count = 3;
const heir = Object.create(space), own = Object.create(space); __defProp(own, "add", { value: (a, b) => a * b });
const all = [space, heir, own, heir];
const said = [];
function run(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { sum = sum + all[turn & 3].add(turn, 2) | 0; } return sum; }
console.log(run(300));
