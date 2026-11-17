"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true, configurable: true });
};
function table(held) { return { pick: () => held, grow: () => held = held + 1 | 0 }; }
var one = {}, two = {};
__export(one, table(1));
__export(two, table(200));
const both = [one, two];
function run(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) sum = sum + one.pick + two.pick + (turn & 1 ? one.grow : two.grow) + both[turn & 1].pick | 0; return sum; }
console.log(run(JSON.parse("30")), one.pick, two.pick);
