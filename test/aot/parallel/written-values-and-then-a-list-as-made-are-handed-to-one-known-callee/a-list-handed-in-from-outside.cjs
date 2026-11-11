'use strict';
// STATISTIC: SpreadCallsUnpackedToParameters = 0
function inner(who, count, first, second) { return [typeof who, count, first === undefined ? "none" : first, second === undefined ? "none" : second].join(":"); }

const lists = JSON.parse('[[],[1],[1,2],[1,2,3,4,5]]');
function outer(list) { return inner(outer, list.length, ...list); }
const byValue = JSON.parse("[0,1]").map(() => outer);
function run(turn) { return byValue[turn & 1](lists[turn % 4]); }
const turns = JSON.parse("7");
const out = [];
for (let turn = 0; turn < turns; turn++) out.push(run(turn));
console.log(out.join(" "));
