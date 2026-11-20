"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true, configurable: true });
};
var space = {};
__export(space, { first: function () { delete this.second; return 1; }, second: () => second });
const second = 2;
console.log(space.second, space.first, space.second);
function again(turns) { let said = ""; for (let turn = 0; turn < turns; turn++) said += space.second + "," + space.first + ","; return said; }
console.log(again(JSON.parse("3")));
