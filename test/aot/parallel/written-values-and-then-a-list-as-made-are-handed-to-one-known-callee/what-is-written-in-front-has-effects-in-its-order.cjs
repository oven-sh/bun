'use strict';
// STATISTIC: CallsWhoseParametersAreReadOutOfList >= 1
let order = "";
function note(word) { order += word; return word; }
function inner(a, b, c, d) { return [a, b, c, d].join(); }
function outer(...rest) { return inner(note("1"), note("2"), ...rest); }
const byValue = JSON.parse("[0,1]").map(() => outer);
function run(turn) { order = ""; return byValue[turn & 1](note("x"), note("y")) + order; }
const turns = JSON.parse("7");
const out = [];
for (let turn = 0; turn < turns; turn++) out.push(run(turn));
console.log(out.join(" "));
