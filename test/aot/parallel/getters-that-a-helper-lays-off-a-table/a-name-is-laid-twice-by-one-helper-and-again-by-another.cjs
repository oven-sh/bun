"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true, configurable: true });
};
var __exportAgain = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true, configurable: true });
};
var twice = {}, both = {};
__export(twice, { pick: () => 1, kept: () => 10 });
__export(twice, { pick: () => 2, other: () => 20 });
__export(both, { pick: () => 3, alone: () => 30 });
__exportAgain(both, { pick: () => 4, late: () => 40 });
function run(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) sum = sum + twice.pick + twice.kept + twice.other + both.pick * 100 + both.alone + both.late | 0; return sum; }
console.log(run(JSON.parse("7")));
