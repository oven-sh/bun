// Rows that are computed side by side, in a loop that sums integers, carries numbers and passes others on.
function make() {
  var width, height, rowSize;
  function set(w, h, s) { width = w; height = h; rowSize = s; }
  function solveBesideSum(x, x0, a, c) {
    var inverse = 1 / c, total = 0;
    for (var k = 0; k < 2; k++) {
      for (var j = 1; j <= height; j++) {
        var lastRow = (j - 1) * rowSize, currentRow = j * rowSize, nextRow = (j + 1) * rowSize;
        var count = (j * 5) & 31;
        var lastX = x[currentRow];
        ++currentRow;
        for (var i = 1; i <= width; i++)
          lastX = x[currentRow] = (x0[currentRow] + a * (lastX + x[++currentRow] + x[++lastRow] + x[++nextRow])) * inverse;
        total += count;
      }
      x[0] = 0.5 * (x[1] + x[rowSize]);
    }
    return total;
  }
  function solveBesideEarlierCounts(x, x0, a, c) {
    var inverse = 1 / c, previous = 3, earlier = 9;
    for (var k = 0; k < 2; k++) {
      for (var j = 1; j <= height; j++) {
        var lastRow = (j - 1) * rowSize, currentRow = j * rowSize, nextRow = (j + 1) * rowSize;
        var count = (j * 5) & 31;
        var added = previous * 0.5 + earlier * 0.125, next = count * 0.25;
        var lastX = x[currentRow];
        ++currentRow;
        for (var i = 1; i <= width; i++)
          lastX = x[currentRow] = (x0[currentRow] + a * (lastX + x[++currentRow] + x[++lastRow] + x[++nextRow]) + added + next) * inverse;
        earlier = previous;
        previous = count;
      }
      x[0] = 0.5 * (x[1] + x[rowSize]);
    }
    return previous * 100 + earlier;
  }
  return { set, solveBesideSum, solveBesideEarlierCounts };
}
const nest = make();
function run(how, x, x0, a, c, w, h, s) { nest.set(w, h, s); return nest[how](x, x0, a, c); }
function fill(n, how) { var l = new Array(n); for (var i = 0; i < n; i++) l[i] = how ? Math.sin(i) : i * 0.37 - 4; return l; }
function sum(l) { let t = 0; for (let i = 0; i < l.length; i++) t += l[i] * (i % 13); return t; }
for (const how of ["solveBesideSum", "solveBesideEarlierCounts"]) {
  for (const [w, h] of [[128, 1], [16, 17], [30, 8], [5, 40], [64, 3], [64, 64], [160, 33]]) {
    const n = (w + 4) * (h + 3), x = fill(n, 1), x0 = fill(n, 0);
    console.log(how, w, h, run(how, x, x0, 0.25, 4, w, h, w + 2), sum(x), x[n >> 1]);
  }
}
