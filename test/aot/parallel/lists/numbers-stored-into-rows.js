// Loops that store numbers into rows of tables: copies, sums, products, tables of least costs, shortest ways, stencils, swaps; rows of every kind.
// STATISTIC: ArraysConvertedToDoubleStorage >= 21
// STATISTIC: ArrayRowsHoisted >= 30
function copies(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) o[y][x] = g[y][x]; return 0;
}
function copiesToLength(g, o, h, n, m) {
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) o[y][x] = g[y][x]; return 0;
}
function transposes(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) o[x][y] = g[y][x]; return 0;
}
function doubles(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) o[y][x] = g[y][x] * 2 + 1; return 0;
}
function halves(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) o[y][x] = g[y][x] / 2; return 0;
}
function adds(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) o[y][x] += g[y][x]; return 0;
}
function steps(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) o[y][x]++; return 0;
}
function least(g, o, h, n, m) {
  for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) o[y][x] = Math.min(o[y - 1][x], o[y][x - 1]) + g[y][x]; return 0;
}
function longest(g, o, h, n, m) {
  for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) o[y][x] = g[y][x] === g[x][y] ? o[y - 1][x - 1] + 1 : Math.max(o[y - 1][x], o[y][x - 1]); return 0;
}
function byRows(g, o, h, n, m) {
  for (let y = 1; y < n; y++) { const a = o[y - 1], b = o[y], c = g[y]; for (let x = 1; x < m; x++) b[x] = Math.min(a[x], b[x - 1]) + c[x]; } return 0;
}
function ways(g, o, h, n, m) {
  for (let k = 0; k < n; k++) for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) if (o[y][k] + o[k][x] < o[y][x]) o[y][x] = o[y][k] + o[k][x]; return 0;
}
function products(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) { let t = 0; for (let k = 0; k < n; k++) t += g[y][k] * g[k][x]; o[y][x] = t; } return 0;
}
function stencil(g, o, h, n, m) {
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < m - 1; x++) o[y][x] = (g[y - 1][x] + g[y + 1][x] + g[y][x - 1] + g[y][x + 1]) / 4; return 0;
}
function roots(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) o[y][x] = Math.sqrt(g[y][x]); return 0;
}
function rounds(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) o[y][x] = Math.round(g[y][x] * 1.5); return 0;
}
function cuts(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) o[y][x] = (g[y][x] * 3) | 0; return 0;
}
function larger(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) if (g[y][x] > o[y][x]) o[y][x] = g[y][x]; return 0;
}
function counts(g, o, h, n, m) {
  for (let i = 0; i < n * m; i++) o[i % n][(i * 3) % m]++; return 0;
}
function scatters(g, o, h, n, m) {
  for (let i = 0; i < n * m; i++) o[i % n][(i * 3) % m] = i * 0.5; return 0;
}
function swaps(g, o, h, n, m) {
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < m; x++) { const t = o[y][x]; o[y][x] = o[y + 1][x]; o[y + 1][x] = t; } return 0;
}
function lastFraction(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) o[y][x] = x === m - 1 ? 0.5 : x; return 0;
}
function notNumbers(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) o[y][x] = (g[y][x] - 1) / (x - 2); return 0;
}
function twoTables(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) { o[y][x] = g[y][x] * 3; h[y][x] = o[y][x] - 1; } return 0;
}
function sums(g, o, h, n, m) {
  let s = 0; for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) { s += g[y][x]; o[y][x] = s; } return s;
}
function grows(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m + 2; x++) o[y][x] = g[y][x] * 2; return 0;
}
function replaces(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) { o[y][x] = g[y][x] * 2; if (x === 1 && y === 1) o[y] = [9, 9, 9, 9, 9]; } return 0;
}
function calls(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) { o[y][x] = g[y][x] * 2; touch(o, y); } return 0;
}
function own(g, o, h, n, m) {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) g[y][x] = g[y][(x + 1) % m] * 2; return 0;
}
function guarded(g, o, h, n, m) {
  try { for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) o[y][x] = g[y][x] * 2; } catch (error) { return error.name; } return 0;
}
let touched = 0;
function touch(o, y) {
  touched++;
  if (touched % 5 === 0) o[y].length = 3;
  if (touched % 7 === 0) o[y][1] = "t";
  if (touched % 11 === 0) o[y] = o[0];
}
let shared = [];
const kinds = {
  "ints": () => [1, 2, 3, 4, 5],
  "doubles": () => [0.5, 1.5, 2.5, 3.5, 4.5],
  "late double": () => [1, 2, 3, 4, 5.5],
  "whole doubles": () => (() => { const l = [0.5, 2, 3, 4, 5]; l[0] = 1; return l; })(),
  "mixed": () => [1, "2", null, 4.5, undefined],
  "texts": () => ["a", "b", "c", "d", "e"],
  "holes": () => [1, , 3, , 5],
  "holes of doubles": () => [0.5, , 2.5, , 4.5],
  "short": () => [1, 2],
  "short doubles": () => [0.5],
  "empty": () => [],
  "room": () => new Array(5),
  "filled": () => new Array(5).fill(0),
  "frozen": () => Object.freeze([1, 2, 3, 4, 5]),
  "missing": () => undefined,
  "text": () => "01234",
  "view": () => new Float64Array(5),
  "bytes": () => new Uint8Array([250, 251, 252, 253, 254]),
  "one for all": () => shared,
  "far": () => [2147483647, 2147483648, -2147483649, 1073741824, 3],
  "zeros": () => [-0, 0, NaN, Infinity, 1],
  "objects": () => [{ valueOf() { touched += 10; return 3; } }, 2, 3, 4, 5],
  "bigints": () => [1n, 2n, 3n, 4n, 5n],
  "accessor": () => Object.defineProperty([1, 2, 3, 4, 5], 2, { get() { touched += 100; return 8; }, set() { touched += 1000; } }),
  "own prototype": () => Object.setPrototypeOf([1, , 3, 4], Object.create(Array.prototype, { 1: { value: 9, writable: true }, 4: { set() { touched += 5000; } } })),
};
const functions = { copies, copiesToLength, transposes, doubles, halves, adds, steps, least, longest, byRows, ways, products, stencil, roots, rounds, cuts, larger, counts, scatters, swaps, lastFraction, notNumbers, twoTables, sums, grows, replaces, calls, own, guarded };
const word = (value) => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? "'" + value : value !== null && typeof value === "object" ? "{}" : String(value));
function showRow(row) {
  if (!row || typeof row !== "object") return String(row);
  const all = [];
  for (let i = 0; i < Math.min(row.length, 8); i++) all.push(i in row ? word(row[i]) : "hole");
  return row.length + ":" + all.join();
}
const show = (rows) => rows.map(showRow).join(";");
const log = [], n = JSON.parse("4"), m = JSON.parse("5");
let numberOfCase = 0;
for (let times = 0; times < 2; times++) {
  for (const kind of Object.keys(kinds)) {
    for (const other of ["ints", "doubles", kind]) {
      for (const mine of ["ints", "doubles", kind]) {
        for (const name of Object.keys(functions)) {
          if (numberOfCase++ % 13) continue;
          shared = [1, 2, 3, 4, 5];
          touched = 0;
          const g = [], o = [], h = [];
          for (let y = 0; y < 5; y++) {
            g.push(kinds[mine]());
            o.push(y === 2 ? kinds[kind]() : kinds[other]());
            h.push(kinds[other]());
          }
          let answer;
          try {
            answer = functions[name](g, o, h, n, m);
          } catch (error) {
            answer = error.name;
          }
          log.push(name + " " + kind + " " + other + " " + mine + ": " + answer + " " + show(o) + " | " + show(g) + " | " + show(h) + " " + touched);
        }
      }
    }
  }
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, sum);
for (let i = 0; i < log.length; i += 7) console.log(log[i]);
