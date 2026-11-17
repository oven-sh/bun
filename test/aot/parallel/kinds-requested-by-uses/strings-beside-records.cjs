// STATISTIC: StringsChosenByNames >= 1
// Elements are proven to be strings or records without a length. The loop reads lengths, so it speculates strings.
function total(values) { let sum = 0; for (let i = 0; i < values.length; i++) sum += values[i].length; return sum; }
const values = []; for (let i = 0; i < 24; i++) values.push("row" + i);
console.log(total([{ 0: 1, 1: 2 }]), total(values), total(["", { a: 1 }, "xyz"]), total([]));
try { total([undefined]); } catch (error) { console.log(error.constructor.name); }
console.log(total(["ab", { b: 2 }, "c"]), total(values));
