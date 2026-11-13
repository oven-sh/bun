// What the unboxed read must keep: a place of the row that holds nothing gives NaN; a product of BigInts beside a number throws; a difference, a quotient and a negation to come are operators on numbers too.
"use strict";
function sums(row, a, b) { for (let j = 0; j < row.length; j++) for (let k = 0; k < a.length; k++) row[j] += a[k] * b[k]; return row; }
function others(a, b) { const row = new Array(3).fill(1); for (let j = 0; j < 3; j++) for (let k = 0; k < a.length; k++) { row[j] += a[k] - b[k]; row[j] += a[k] / b[k]; row[j] += -a[k]; row[j] += a[k] % b[k]; row[j] += a[k] ** 2; } return row; }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name); } }
for (let round = 0; round < 200; round++) sums(new Array(3).fill(0), [1.5, 2], [3, 4]);
tell(() => sums(new Array(3).fill(0), [1.5, 2], [3, 4]));
tell(() => sums(new Array(3), [1.5, 2], [3, 4]));
tell(() => sums([1, , 3], [1.5, 2], [3, 4]));
tell(() => sums(new Array(3).fill(0), [1n, 2n], [3n, 4n]));
tell(() => sums(new Array(3).fill(0n), [1n, 2n], [3n, 4n]));
tell(() => sums(new Array(3).fill("t"), [1.5, 2], [3, 4]));
tell(() => sums(new Array(2).fill(0), [{ valueOf() { return 2; } }], [3]));
tell(() => others([1.5, 7, -2], [3, 4, 0.5]));
tell(() => others([1, 2], [0, -0]));
console.log(said.join(" | "));
