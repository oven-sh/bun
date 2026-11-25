// Nests whose loops have a constant number of turns store into the rows of a grid: rows that are short, one row under several places, rows that another grid holds too, other lists in their places.
const show = v => (v === undefined ? "_" : Object.is(v, -0) ? "-0" : String(v));
const said = grid => Array.from(grid, row => (row && typeof row === "object" ? "[" + Array.from(row, show).join(" ") + "]" : show(row))).join("");
const told = grid => { let out = ""; for (let y = 0; y < grid.length; y++) { const row = grid[y]; for (let x = 0; x < row.length; x++) out += row[x] + (x + 1 < row.length ? " " : "|"); } return out; };
const grid = (h, w, f) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => f(y, x)));

function shaded(to, from, weight) {
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) to[y][x] = from[y][x] * weight + from[y][0] * 0.5 - from[0][x] + from[4][x] * 0.25 + from[y][4];
  return to;
}
function leaned(to, from, other) {
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) to[y][x] = to[y][x] - from[y][x] * other[0][x] + from[y][5] * other[5][x] - other[1][x] * 0.5 + from[2][x] + from[y][1];
  return to;
}
function settled(to, from) {
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) to[y][x] = (from[y][0] + from[y][1] + from[y][2] + from[y][3] + from[y][4]) * 0.2 + from[y][x] + from[0][x] * 0.125;
  return to;
}
function counted(to, from) {
  let total = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { to[y][x] = (from[y][x] + from[y][0] + from[3][x]) | 0; total += to[y][x]; }
  return total;
}
function tied(to, from, k) {
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) to[y][x] = from[0][x] * from[y][0] + from[1][x] * from[y][1] - from[2][x] * k + to[y][x] * 0.5 + from[3][x] - from[4][x] + from[5][x];
  return to;
}

function shadedAny(to, from, weight) {
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) to[y][x] = from[y][x] * weight + from[y][0] * 0.5 - from[0][x] + from[4][x] * 0.25 + from[y][4];
  return to;
}
function leanedAny(to, from, other) {
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) to[y][x] = to[y][x] - from[y][x] * other[0][x] + from[y][5] * other[5][x] - other[1][x] * 0.5 + from[2][x] + from[y][1];
  return to;
}
function settledAny(to, from) {
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) to[y][x] = (from[y][0] + from[y][1] + from[y][2] + from[y][3] + from[y][4]) * 0.2 + from[y][x] + from[0][x] * 0.125;
  return to;
}
function countedAny(to, from) {
  let total = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { to[y][x] = (from[y][x] + from[y][0] + from[3][x]) | 0; total += to[y][x]; }
  return total;
}

const numbers = (y, x) => y * 1.5 - x * 0.25 + (y === x ? 1 : 0), whole = (y, x) => y * 7 - x * 3;
const halves = (y, x) => x * 0.5 - y * 0.75;
// Grids of numbers alone.
for (let k = 0; k < 60; k++) { const to = shaded(grid(5, 5, numbers), grid(5, 5, (y, x) => numbers(x, y) + k), 0.75); if (k % 20 === 0) console.log(told(to)); }
for (let k = 0; k < 60; k++) { const to = leaned(grid(6, 6, numbers), grid(6, 6, (y, x) => halves(x, y) - k), grid(6, 6, (y, x) => x - y * 0.5)); if (k % 20 === 0) console.log(told(to)); }
for (let k = 0; k < 60; k++) { const to = settled(grid(5, 5, numbers), grid(5, 5, (y, x) => halves(y, x) + k)); if (k % 20 === 0) console.log(told(to)); }
for (let k = 0; k < 60; k++) { const to = tied(grid(6, 6, numbers), grid(6, 6, halves), k); if (k % 20 === 0) console.log(told(to)); }
for (let k = 0; k < 60; k++) { const to = grid(4, 4, whole), n = counted(to, grid(4, 4, (y, x) => whole(x, y) + k)); if (k % 20 === 0) console.log(n, told(to)); }
const gridOf = (h, w, f) => { const rows = []; for (let y = 0; y < h; y++) { const row = []; for (let x = 0; x < w; x++) row.push(f(y, x)); rows.push(row); } return rows; };
for (const [name, way, size] of [["shaded", (a, b) => shadedAny(a, b, 0.75), 5], ["leaned", (a, b) => leanedAny(a, b, gridOf(6, 6, (y, x) => x - y * 0.5)), 6], ["settled", settledAny, 5], ["counted", countedAny, 4]]) {
  for (const f of [numbers, whole]) {
    for (let k = 0; k < 6; k++) { const to = gridOf(size, size, f), from = gridOf(size, size, (y, x) => f(x, y) + k); const r = way(to, from); if (k === 5) console.log(name, typeof r === "number" ? r : "", said(to)); }
    // Short rows, a row that stands at two places, rows of the one grid in the other, one grid for both.
    const short = gridOf(size, size - 2, f); way(short, gridOf(size, size, f)); console.log(said(short));
    const from = gridOf(size, size, f); from[1] = from[0]; from[2] = [1, 2]; const to = gridOf(size, size, f); to[3] = to[1]; way(to, from); console.log(said(to), said(from));
    const shared = gridOf(size, size, f), holds = gridOf(size, size, f); holds[1] = shared[0]; holds[0] = shared[1]; way(holds, shared); console.log(said(holds), said(shared));
    const same = gridOf(size, size, f); way(same, same); console.log(said(same));
    const views = Array.from({ length: size }, (_, y) => Float32Array.from({ length: size }, (_, x) => f(y, x))); way(views, gridOf(size, size, f)); console.log(said(views));
    const mixed = gridOf(size, size, f); mixed[1] = new Int8Array(size); mixed[2] = { 0: 1, 1: 2, length: 2 }; way(mixed, from); console.log(said(mixed.map(r => Array.from({ length: size }, (_, i) => r[i]))));
    const holes = gridOf(size, size, f); delete holes[1][2]; delete holes[0][0]; way(gridOf(size, size, f), holes); way(holes, gridOf(size, size, f)); console.log(said(holes));
  }
}
let stores = 0; const watched = gridOf(5, 5, numbers); watched[2] = new Proxy([1, 2, 3, 4, 5], { set(t, k, v) { stores++; t[k] = v; return true; }, get(t, k) { return t[k]; } });
console.log(said(shadedAny(watched, gridOf(5, 5, whole), 2)), stores);
for (const bad of [undefined, null, 7, "text"]) { const to = gridOf(5, 5, numbers); to[3] = bad; try { console.log(said(settledAny(to, gridOf(5, 5, numbers)))); } catch (error) { console.log(error.constructor.name, said(to.slice(0, 3))); } }
const frozen = gridOf(5, 5, numbers); Object.freeze(frozen[1]); console.log(said(settledAny(frozen, gridOf(5, 5, whole))));
