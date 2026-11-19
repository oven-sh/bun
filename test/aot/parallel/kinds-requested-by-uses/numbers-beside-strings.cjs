// STATISTIC: KindsChosenByOperators >= 1
// Elements are proven to be numbers or strings. The operator takes numbers alone, so the loop speculates numbers.
function total(rows) { let sum = 0; for (let i = 0; i < rows.length; i++) sum += rows[i][0] * rows[i][1]; return sum; }
const rows = []; for (let i = 0; i < 24; i++) rows.push([i, i + 1]);
console.log(total(["ab", "34", ""]), total(rows), total([["5", 6], [-0, 1]]), total(["12"]), total([[1.5, "x"], [2, 3]]));
function rest(values) { let sum = 0; for (const value of values) sum = sum - value % 4; return sum; }
console.log(rest([1, 2, 3, 4.5]), rest(["7", "x"]), rest([1, "9", -0]), Object.is(rest([-0]), 0));
console.log(total(rows));
