'use strict';
// STATISTIC: CallsWhoseParametersAreReadOutOfList >= 1
function inner(list, first, second) { list.length = 0; list.push("changed"); return first + ":" + second + ":" + list.join(); }
function outer(...rest) { return inner(rest, ...rest) + "/" + rest.join(); }
const byValue = JSON.parse("[0,1]").map(() => outer);
function run(turn) { return byValue[turn & 1](turn, "b") + byValue[turn & 1](); }
const turns = JSON.parse("7");
const out = [];
for (let turn = 0; turn < turns; turn++) out.push(run(turn));
console.log(out.join(" "));
