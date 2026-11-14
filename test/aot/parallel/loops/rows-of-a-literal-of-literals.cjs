// STATISTIC: RowStoresMaybeAppending >= 1
// The rows of a literal of empty literals are filled under a counter that starts at their length.
function multiply(a, b) {
  const product = [[], [], [], []];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) product[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j] + a[i][3] * b[3][j];
  }
  return product;
}
function rotate(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0.5, 0, 0, 1]];
}
let m = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
for (let turn = 0; turn < 60; turn++) m = multiply(rotate(turn * 0.25), m);
console.log(m.map(row => row.length + ":" + row.map(x => x.toFixed(6)).join()).join("|"));

// The rows are longer than what the loop stores, or one row is another's.
function partly(source, count) {
  const rows = [[], [9, 8, 7, 6, 5, 4], []];
  const same = rows[0];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < count; j++) rows[i][j] = source[j] * (i + 0.5);
  }
  return same.length + "/" + rows.map(row => row.join()).join("|");
}
console.log(partly([1, 2.5, 3], 3), partly([1, 2.5, 3], 0), partly([1, 2.5, NaN, -0], 4), partly(["a", 2, 3], 3), partly([1], 3));

// Adding to the row that is read.
function growing(count) {
  const rows = [[], []];
  rows[1] = rows[0];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < count; j++) rows[i][j] = (rows[1 - i][j - 1] || 1) + j * 0.5;
  }
  return rows[0].join() + "|" + rows[1].length;
}
console.log(growing(3), growing(20));
