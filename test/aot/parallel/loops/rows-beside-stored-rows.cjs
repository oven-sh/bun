// STATISTIC: ArraysComparedWithStoredArrays >= 1
// A loop appends to one row and reads others: that they are other rows is checked before the loop, and what they hold is read there.
function multiply(a, b) {
  const product = [[], [], [], []];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) product[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j] + a[i][3] * b[3][j];
  }
  return product;
}
function into(product, a, b, n) {
  for (let i = 0; i < product.length; i++) {
    for (let j = 0; j < n; j++) product[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j];
  }
  return product;
}
function fill(target, source, factor) {
  for (let k = 0; k < target.length; k++) target[k] = source[0] * factor[k] + source[1];
  return target;
}
const show = (rows) => rows.map((row) => row.join()).join(';');
const unit = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const turned = [[0.5, -0.25, 0, 0], [0.25, 0.5, 0, 0], [0, 0, 1, 0], [1.5, 2.5, 3.5, 1]];
const out = [];
let last = unit;
for (let turn = 0; turn < 40; turn++) {
  last = multiply(turn % 3 ? turned : unit, turn % 2 ? last : turned);
  out.push(show(last));
}
out.push(show(multiply([[1, , 3, 4], [1], [], [1, 2, 3, NaN]], turned)));
for (let turn = 0; turn < 30; turn++) {
  const a = [[turn, 1.5], [2.5, turn]], b = [[1, 2, 3], [0.5, 0.25, 0.125]];
  out.push(show(into([[], []], a, b, 3)), show(into([[0, 0, 0], [0.5]], a, b, 3)));
  // The row that is stored into is a row that is read.
  out.push(show(into([a[0], a[1]], a, b, 2)), show(into([b[0], b[1]], a, b, 3)), show(into(a, a, b, 2)), show(into([b[1], b[1]], a, b, 3)));
  const same = [turn, 2, 3, 4];
  out.push(fill(same, same, [1, 2, 3, 4]).join(), fill([1, 2, 3], same, [0.5, 0.25, turn]).join(), fill(same, [2, 1], same).join());
}
try { multiply(unit, [[1], null, [2], [3]]); } catch (e) { out.push(e.constructor.name); }
let h = 0;
for (const text of out) for (let c = 0; c < text.length; c++) h = (h * 31 + text.charCodeAt(c)) | 0;
console.log(h, out.slice(0, 6).join(' '), out.slice(-9).join(' '));
