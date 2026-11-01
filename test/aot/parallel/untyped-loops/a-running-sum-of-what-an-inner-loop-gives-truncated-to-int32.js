// (sum + totalOf(row)) | 0 with the loop of totalOf() in line takes the low word of the sum whatever the inner loop gives: a whole number of any size, a fraction, -0, NaN, an infinity.
const tables = [
  [[1, 2, 3], [4, 5], [6]],
  [[0.5, 1.5], [-2.25, 1e-9], [0.25, 0.25, 0.5]],
  [[2147483647], [1], [2147483647, 2], [2147483648]],
  [[-2147483648, -1], [4294967296], [4294967297.5], [-4294967295]],
  [[9007199254740991, 1], [9007199254740992, 1], [-9007199254740993], [1e21, -1e21, 3]],
  [[NaN, 1], [Infinity], [2], [-Infinity, 3], [Infinity, -Infinity]],
  [[-0], [-0, -0], [0, -0], []],
];
const floats = tables.map(table => table.map(row => Float64Array.from(row)));
function sumOfRows(rows, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const row = rows[i % rows.length];
    let total = i & 1;
    for (let c = 0; c < row.length; c++) total += row[c];
    sum = (sum + total) | 0;
  }
  return sum;
}
function sumBesideALoop(rows, turns) {
  let sum = 0, seen = 0;
  for (let i = 0; i < turns; i++) {
    const row = rows[i % rows.length];
    for (let c = 0; c < row.length; c++) seen++;
    sum = (sum + (row.length ? row[0] : -0)) | 0;
  }
  return sum + ":" + seen;
}
function unsignedSumOfRows(rows, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const row = rows[i % rows.length];
    let total = 0;
    for (const value of row) total += value;
    sum = (sum + total) >>> 0;
  }
  return sum;
}
function lastTotal(rows, turns) {
  let sum = 0, total = -0;
  for (let i = 0; i < turns; i++) {
    total = -0;
    for (const value of rows[i % rows.length]) total += value;
    sum = (sum + total) | 0;
  }
  return Object.is(total, -0) ? "-0" : String(total);
}
for (const kind of [tables, floats]) {
  for (const rows of kind) {
    for (const turns of [0, 1, 2, 3, 4, 5, 7, 64, 1000]) {
      console.log(turns, sumOfRows(rows, turns), sumBesideALoop(rows, turns), unsignedSumOfRows(rows, turns), lastTotal(rows, turns));
    }
  }
}
