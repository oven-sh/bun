'use strict';
// STATISTIC: SpreadCallsUnpackedToParameters >= 1
function inner(first) { return "got " + first; }
function outer(...rest) { return inner("a", "b", "c", ...rest); }
const byValue = JSON.parse("[0,1]").map(() => outer);
function run(turn) { return byValue[turn & 1]() + byValue[turn & 1](turn) + byValue[turn & 1](turn, 2, 3); }
const turns = JSON.parse("7");
const out = [];
for (let turn = 0; turn < turns; turn++) out.push(run(turn));
console.log(out.join(" "));
