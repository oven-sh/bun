"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true, configurable: true });
};
var space = {};
__export(space, { first: () => first, second: () => second });
const second = 2;
function first(tag) { delete this.second; return tag; }
function look(turns) { let said = ""; for (let turn = 0; turn < turns; turn++) said += space.second + "," + (turn === 1 ? space.first("a") : "-") + ","; return said; }
console.log(look(JSON.parse("4")));
