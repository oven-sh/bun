'use strict';
// STATISTIC: CallsWhoseParametersAreReadOutOfList >= 1
function inner(who, count, first, second) { return [typeof who, count, first === undefined ? "none" : first, second === undefined ? "none" : second].join(":"); }

function outer(...rest) { return inner(outer, rest.length, ...rest); }
const table = JSON.parse("[0,1]").map(() => outer);
function run(turn) { let said = ""; for (let i = 0; i < 3; i++) said += outer(turn, i) + table[i & 1](turn, i, "by value"); return said; }
const turns = JSON.parse("7");
const out = [];
for (let turn = 0; turn < turns; turn++) out.push(run(turn));
console.log(out.join(" "));
