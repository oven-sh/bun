'use strict';
// STATISTIC: CallsWhoseParametersAreReadOutOfList = 0
function inner(who, ...others) { return others.length + ":" + others.join(); }
function outer(...rest) { return inner(outer, rest.length, ...rest); }
const byValue = JSON.parse("[0,1]").map(() => outer);
function run(turn) { return byValue[turn & 1]() + byValue[turn & 1](turn) + byValue[turn & 1](turn, 2, 3, 4); }
const turns = JSON.parse("7");
const out = [];
for (let turn = 0; turn < turns; turn++) out.push(run(turn));
console.log(out.join(" "));
