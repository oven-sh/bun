// STATISTIC: OtherProvenKindsTested >= 1
// Elements are proven to be strings or arrays. Both have a typed length, so the loop tests for the second kind as well.
function total(values) { let sum = 0; for (let i = 0; i < values.length; i++) sum += values[i].length; return sum; }
const values = []; for (let i = 0; i < 24; i++) values.push("row" + i);
console.log(total([[1, 2], [3]]), total(values), total(["", [1], "xyz", [, ,]]), total([]), total({ length: 2, 0: [1, 2], 1: "four" }));
try { total(["a", undefined, "b"]); } catch (error) { console.log(error.constructor.name); }
values[5] = [1, 2, 3]; console.log(total(values));
