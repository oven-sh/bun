// Loops over the rows of an instance of a class that extends Array: nothing above the instance answers for a row that is present.
// STATISTIC: RowHoldersCheckedByStorage >= 1
class Grid extends Array {}
class Other extends Array {}
globalThis["grid" + process.pid] = [Grid, Other];
function make(C, rows, columns, f) {
  const grid = new C(rows);
  for (let i = 0; i < rows; i++) {
    grid[i] = new Array(columns);
    for (let j = 0; j < columns; j++) grid[i][j] = f(i, j);
  }
  grid.rows = rows;
  grid.columns = columns;
  return grid;
}
function sumColumns(grid, sums) {
  for (let i = 0; i < grid.rows; i++) for (let j = 0; j < grid.columns; j++) sums[0][j] += grid[i][j];
  return sums[0].join();
}
function sumRows(grid, sums) {
  for (let i = 0; i < grid.rows; i++) for (let j = 0; j < grid.columns; j++) sums[i][0] += grid[i][j];
  return sums.map((row) => row[0]).join();
}
function product(a, b, out) {
  const n = a.columns, column = new Array(n);
  for (let j = 0; j < b.columns; j++) {
    for (let k = 0; k < n; k++) column[k] = b[k][j];
    for (let i = 0; i < a.rows; i++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += a[i][k] * column[k];
      out[i][j] = s;
    }
  }
  return out.map((row) => row.join()).join(";");
}
function scale(a, b, x) {
  for (let i = 0; i < a.rows; i++) for (let j = 0; j < a.columns; j++) a[i][j] = a[i][j] * x + b[i][j];
  return Array.from(a, (row) => row.join()).join(";");
}
function transpose(a, out) {
  for (let i = 0; i < a.rows; i++) for (let j = 0; j < a.columns; j++) out[j][i] = a[i][j];
  return out.map((row) => row.join()).join(";");
}
function byHalves(grid, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += grid[i / 2][0];
  return s;
}
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
}
const zeros = () => Array.from({ length: 4 }, () => [0.5, 0, 0, 0]);
const fills = { halves: (i, j) => i * 4 + j + 0.5, whole: (i, j) => i - j, mixed: (i, j) => (j === 1 ? i : i + 0.25), texts: (i, j) => "t" + i + j, odd: (i, j) => [NaN, -0, 2 ** 31, undefined][(i + j) % 4] };
const changes = {
  nothing() {},
  hole(grid) { delete grid[1]; },
  above(grid, C) { delete grid[1]; C.prototype[1] = [9, 8, 7]; },
  replaced(grid) { grid[1] = grid[0]; },
  view(grid) { grid[1] = new Float64Array([1.5, 2, 3]); },
  text(grid) { grid[1] = "abc"; },
  record(grid) { grid[1] = { 0: 1, 1: 2, 2: 3, length: 3, join: () => "record" }; },
  accessor(grid) { Object.defineProperty(grid, 1, { get: () => [4, 5, 6], configurable: true }); },
  frozen(grid) { Object.freeze(grid); Object.freeze(grid[0]); },
  proxied(grid) { grid[1] = new Proxy([1, 2, 3], {}); },
  prototype(grid) { Object.setPrototypeOf(grid, { __proto__: null, 1: [3, 3, 3] }); delete grid[1]; },
  itself(grid) { grid[1] = grid; },
  short(grid) { grid[1].length = 1; },
  halves(grid, C) { grid["0.5"] = [100]; C.prototype["1.5"] = [1000]; },
  columns(grid) { Object.defineProperty(grid, "columns", { get() { return 2; } }); },
};
for (const C of [Grid, Other, Array]) {
  for (const fill of Object.keys(fills)) {
    for (const change of Object.keys(changes)) {
      const grid = make(C, 3, 3, fills[fill]), beside = make(C, 3, 3, (i, j) => i / 2 + j);
      const results = [attempt(() => sumColumns(grid, zeros())), attempt(() => product(grid, beside, zeros()))];
      results.push(attempt(() => changes[change](grid, C === Array ? Grid : C)));
      results.push(attempt(() => sumColumns(grid, zeros())), attempt(() => sumRows(grid, zeros())), attempt(() => product(grid, beside, zeros())), attempt(() => product(beside, grid, zeros())), attempt(() => transpose(grid, zeros())), attempt(() => scale(grid, beside, 2)), attempt(() => scale(grid, grid, -0)), attempt(() => sumRows(beside, grid)), attempt(() => byHalves(grid, 5)), attempt(() => byHalves(beside, 1)));
      for (const key of [1, 1.5]) {
        delete Grid.prototype[key];
        delete Other.prototype[key];
      }
      console.log(C.name, fill, change, results.join(" | "));
    }
  }
}
