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
const said = [];
function run(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { sum = sum + space.count | 0; if (turn === 20) count = 7; } return sum; }
said.push(run(50)); count = "x"; said.push(run(3)); console.log(said.join());
