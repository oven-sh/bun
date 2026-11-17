"use strict";
var __defProp = Object.defineProperty;
var __exportDefault = (target, value) => { __defProp(target, "default", { get: () => value, set: (next) => value = next, enumerable: true, configurable: true }); };
function add(a, b) { return a + b | 0; }
var space = {}, second = {};
__exportDefault(space, add); __exportDefault(second, (a, b) => a - b);
const said = [];
function run(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { sum = sum + space.default(turn, 1) + second.default(turn, 1) | 0; if (turn === 30) space.default = (a, b) => 7; } return sum; }
console.log(run(60));
