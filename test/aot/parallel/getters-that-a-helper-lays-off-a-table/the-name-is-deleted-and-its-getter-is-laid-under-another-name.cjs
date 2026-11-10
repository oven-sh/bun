"use strict";
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true, configurable: true });
};
let kept = 5;
const shared = () => kept;
var space = {};
__export(space, { first: shared, last: () => 9 });
const hidden = Object[JSON.parse("\"defineProperty\"")];
const said = [];
function run(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) sum = sum + (space.first === undefined ? 100 : space.first) + space.last | 0; return sum; }
function call(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { try { sum = sum + space.first.toFixed(0).length | 0; } catch (error) { sum = sum + 1000 | 0; } } return sum; }
said.push(run(JSON.parse("40")), call(JSON.parse("40")));
delete space.first;
hidden(space, "other", { get: shared, enumerable: true, configurable: true });
said.push(run(JSON.parse("40")), call(JSON.parse("40")), space.other);
delete space.last;
hidden(space, "first", { get: () => 7, enumerable: true, configurable: true });
hidden(space, "last", { get: shared, enumerable: true, configurable: true });
said.push(run(JSON.parse("40")), call(JSON.parse("40")));
console.log(said.join());
