// STATISTIC: PreheaderChecksEliminated >= 1
// An inner loop of few iterations over rows: what its lists are asked is asked once before it.
function transform(rows, vectors, size) {
  const out = [];
  for (let v = 0; v < vectors.length; v++) {
    const vector = vectors[v], made = [];
    for (let i = 0; i < size; i++) made[i] = rows[0][i] * vector[0] + rows[1][i] * vector[1] + rows[2][i] * vector[2];
    out.push(made);
  }
  return out;
}
function scaled(target, source, from, size) {
  for (let i = 0; i < size; i++) target[i] = source[0] * from[i] + source[1] * from[i] + source[2];
  return target;
}
const show = (rows) => rows.map((row) => row.join()).join(';');
const out = [];
for (let turn = 0; turn < 30; turn++) {
  const rows = [[1, 2, turn], [0.5, turn, 0.25], [turn, 0, 1]], vectors = [[1, 2, 3], [0.5, 1.5, turn], [turn, turn, turn], [1.5, , 2]];
  out.push(show(transform(rows, vectors, 3)), show(transform(rows, rows, 2)));
  out.push(scaled([0, 0, 0], rows[1], rows[2], 3).join(), scaled(rows[0], rows[0], rows[1], 3).join(), scaled([0.5], [1, 2], rows[1], 1).join(), scaled([1.5, 2.5], ['1', 2, 3], rows[1], 2).join());
}
try { transform([[1], [2], null], [[1, 2, 3]], 1); } catch (e) { out.push(e.constructor.name); }
out.push(show(transform([[1], [2], [3]], [[1, 2, 3]], 3)));
console.log(out.slice(0, 8).join(' '), out.slice(-9).join(' '));
let h = 0;
for (const text of out) for (let c = 0; c < text.length; c++) h = (h * 31 + text.charCodeAt(c)) | 0;
console.log(h);
