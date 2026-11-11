function show(list) { return list.map(x => (Object.is(x, -0) ? "-0" : String(x))).join() + "|" + list.length + "|" + Object.isFrozen(list); }
function fresh() { return [0, 0, 0, 0]; }
function pair() { return [0, -0]; }
function long() { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
function frozen() { return Object.freeze([0, 0]); }
const kept = [];
for (let round = 0; round < 40; round++) {
  const a = fresh(), b = fresh(), c = pair(), d = long(), e = frozen(), f = [0, 0, 0];
  if (a === b) console.log("shared");
  if (round % 2) a[1] = round;
  if (round % 3 === 0) a[2] = round + 0.5;
  if (round % 5 === 0) a[3] = "x" + round;
  if (round % 7 === 0) a.push(round);
  if (round % 11 === 0) a.length = 2;
  if (round % 13 === 0) delete a[0];
  c[0] = c[1];
  d[round % 20] += round;
  try { "use strict"; e[0] = 1; } catch (error) { console.log(error.constructor.name); }
  f[round & 3] = -0;
  kept.push(a, f);
  console.log(show(a), show(b), show(c), show(d), show(e), show(f));
}
console.log(kept.length, show(kept[2]), show(fresh()), JSON.stringify([0, 0]), [0, 0].concat([0]).length, Math.max(...[0, 0, 0]), [0, 0].includes(NaN));
class Grid { constructor(n) { this.rows = []; for (let i = 0; i < n; i++) this.rows.push([0, 0, 0, 0]); } set(i, j, x) { this.rows[i][j] = x; } }
const grid = new Grid(3);
grid.set(0, 1, 5); grid.set(2, 3, 1.5); grid.set(1, 0, "t"); grid.set(1, 9, null);
console.log(JSON.stringify(grid.rows));
const [x, y, z = 7] = [0, 0];
console.log(x, y, z, Object.keys([0, 0]).join(), 2 in [0, 0], [0, 0].hasOwnProperty(1));
