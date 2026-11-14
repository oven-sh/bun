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
function run(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { try { sum = sum + space.add(turn, 1) | 0; } catch (error) { sum = sum - 1; } } return sum; }
said.push(run(50)); delete space.add; said.push(run(50)); console.log(said.join());
