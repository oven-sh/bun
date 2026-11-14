// STATISTIC: LiteralsOfOptionalNumbers >= 1
// The elements of a literal of numbers that may be undefined choose its storage.
function offsetRows(offset) {
  return [[1, 0, offset[0]], [0, 1, offset[1]], [0, 0, 1]];
}
function sum(rows) {
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (let j = 0; j < 3; j++) total += row[j] * (j + 0.5);
  }
  return total;
}
let total = 0;
for (let turn = 0; turn < 60; turn++) total += sum(offsetRows([turn * 0.25, turn]));
console.log(total, sum(offsetRows([1, 2])), sum(offsetRows([])), sum(offsetRows([NaN, -0])), sum(offsetRows([1])));
for (const rows of [offsetRows([]), offsetRows([NaN, -0]), offsetRows([0.5, 2 ** 31]), offsetRows([, 3])]) {
  rows[0].push(undefined);
  rows[1][3] = 0.5;
  rows[2][0] = "text";
  console.log(rows.map(row => row.map(value => Object.is(value, -0) ? "-0" : String(value)).join()).join("|"));
}
