'use strict';
// STATISTIC: SpreadCallsUnpackedToParameters >= 1
const holder = { name: "holder", inner(a, b, c) { return this.name + [a, b, c].join(); } };
function outer(...rest) { return holder.inner("w", ...rest); }
const byValue = JSON.parse("[0,1]").map(() => outer);
function run(turn) { return byValue[turn & 1]() + byValue[turn & 1](turn) + byValue[turn & 1](turn, 2, 3); }
const turns = JSON.parse("7");
const out = [];
for (let turn = 0; turn < turns; turn++) out.push(run(turn));
console.log(out.join(" "));
