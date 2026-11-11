"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true, configurable: true });
};
var space = {};
__export(space, { late: () => late });
const said = [];
function run(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { try { sum = sum + space.late | 0; } catch (error) { sum = sum + (error instanceof ReferenceError ? 1000 : -1) | 0; } } return sum; }
said.push(run(5)); let late = 2; said.push(run(5)); console.log(said.join());
