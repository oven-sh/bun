"use strict";
// The rows are heirs of a view; in late rounds the key is a name that is no index, with a setter above that replaces a row.
const data = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => "[" + Array.from({ length: 6 }, (_, j) => (i * 6 + j) / 4).join() + "]").join() + "]");
function turn(grid, side, key, next, sine, cosine) {
  for (let k = 0; k < side; k++) {
    const held = grid[k][next];
    grid[k][next] = sine * grid[k][key] + cosine * held;
    grid[k][key] = cosine * grid[k][key] - sine * held;
  }
}
const show = grid => grid.map(row => { try { return Array.from(row, x => typeof x === "number" ? +x.toFixed(3) : String(x)).join("+"); } catch (error) { return error.name; } }).join(" ");
const said = [];
for (let round = 0; round < 6; round++) {
  const hostile = round > 2;
  let grid = data.map(row => Float64Array.from(row));
  class Row extends Float64Array {}
  Object.defineProperty(Row.prototype, "far", { set(value) { grid[1] = Row.from(data[5]); }, get() { return 3; }, configurable: true });
  grid = data.map(row => Row.from(row));
  const KEY = at => at, NEXT = at => hostile && at === 2 ? "far" : at + 1, SINE = 0.5 + round;
  try { for (let at = 0; at < 4; at++) turn(grid, grid.length, KEY(at), NEXT(at), SINE, 0.25); said.push(show(grid)); } catch (error) { said.push(error.name + " " + show(grid)); }
}
console.log(said.join("\n"));
