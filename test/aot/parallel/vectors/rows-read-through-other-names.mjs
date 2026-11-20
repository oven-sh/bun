const bits = new DataView(new ArrayBuffer(8));
function hash(list) { let t = 17; for (let i = 0; i < list.length; i++) { const x = list[i]; if (x !== x) { t = (Math.imul(t, 31) + 7) | 0; continue; } bits.setFloat64(0, x); t = (Math.imul(t, 31) + bits.getInt32(0)) | 0; t = (Math.imul(t, 31) + bits.getInt32(4)) | 0; } return list.length + ":" + t; }
function make() {
  var width, height, rowSize;
  function set(w, h, s) { width = w; height = h; rowSize = s; }
  function solve(x, x0, y, p, q, a, c) {
    var out = [];
    for (var k = 0; k < 2; k++) {
      var before = y[p], beforeToo = x[q];
      for (var j = 1; j <= height; j++) {
        var lastRow = (j - 1) * rowSize;
        var currentRow = j * rowSize;
        var nextRow = (j + 1) * rowSize;
        var lastX = x[currentRow];
        ++currentRow;
        for (var i = 1; i <= width; i++)
          lastX = x[currentRow] = (x0[currentRow] + (lastX + x[++currentRow] + x[++lastRow] * 0.5 - x[++nextRow]) / c) * a;
      }
      var after = y[p], afterToo = x[q];
      y[p] = after * 0.5;
      out.push(before, beforeToo, after, afterToo, x[p], y[q], before === after, beforeToo === afterToo);
      for (var m = p; m < p + 3; m++) out.push(y[m], x[m]);
    }
    return out;
  }
  return { set, solve };
}
const nest = make();
function list(n, seed) { var l = new Array(n); for (var i = 0; i < n; i++) l[i] = Math.sin(i * seed) + 0.25; return l; }
const width = 24, rowSize = 26;
for (const leaving of [0, 1, 2, 3, 4, 5, 6, 7, 8]) for (const column of [1, 2, 12, 24]) for (const rows of [4, 8, 9]) {
  const n = (rows + 2) * rowSize + 4;
  const x = list(n, 1.25), x0 = list(n, 0.75);
  if (leaving) x0[Math.min(leaving, rows) * rowSize + column] = NaN;
  nest.set(width, rows, rowSize);
  const p = 2 * rowSize + 3, q = 3 * rowSize + column;
  const out = nest.solve(x, x0, x, p, q, 0.9, 4);
  console.log(leaving, column, rows, hash(x), hash(x0), hash(out.map(Number)), out[6], out[7]);
  const z = list(n, 1.5), same = z;
  if (leaving) z[Math.min(leaving, rows) * rowSize + column] = NaN;
  const told = nest.solve(z, same, same, q, p, 1, 3);
  console.log(hash(z), hash(told.map(Number)));
}
