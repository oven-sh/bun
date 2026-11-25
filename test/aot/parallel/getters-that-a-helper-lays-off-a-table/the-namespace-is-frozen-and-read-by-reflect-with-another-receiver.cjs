"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true, configurable: true });
};
var space = {};
__export(space, { self: function () { return this === space ? 1 : 2; }, plain: () => 4 });
Object.freeze(space);
const other = {};
const said = [];
function run(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { sum = sum + space.self + Reflect.get(space, "self", other) * 10 + space.plain | 0; } return sum; }
console.log(run(40));
