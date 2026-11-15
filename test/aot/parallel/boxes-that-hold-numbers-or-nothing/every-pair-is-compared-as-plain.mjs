const doubles = new Float64Array([1, 0, -0, NaN, 0.5, -1, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 1e300, Infinity, -Infinity, 5e-324]);
const values = [1, 0, -0, NaN, 0.5, undefined, null, -1, 2147483647, -2147483648, 2147483648, 4294967296, 1e300, Infinity, -Infinity];
for (let i = 0; i < doubles.length; i++) values.push(doubles[i]);
const cells = { list: values.slice() };
function same(x, y) { return x === y; }
function other(x, y) { return x !== y; }
function at(i, value) { return cells.list[i] === value; }
function count(value) { let n = 0; for (let i = 0; i < cells.list.length + 2; i++) if (cells.list[i] === value) n++; return n; }
let rows = [];
for (let j = 0; j < values.length; j++) { let row = ""; for (let k = 0; k < values.length; k++) row += (same(values[j], values[k]) ? "1" : "0") + (other(values[j], values[k]) ? "1" : "0") + (at(j, values[k]) ? "1" : "0"); rows.push(row); }
console.log(rows.join("\n"));
console.log(values.map(count).join(" "), at(1000, undefined), at(1000, null), at(-1, undefined));
