"use strict";
// Views in most places; in late rounds one row is the list of rows.
const data = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => "[" + Array.from({ length: 6 }, (_, j) => (i * 6 + j) / 4).join() + "]").join() + "]");
function turn(grid, side, at, sine, cosine) {
  for (let k = 0; k < side; k++) {
    const held = grid[k][at + 1];
    grid[k][at + 1] = sine * grid[k][at] + cosine * held;
    grid[k][at] = cosine * grid[k][at] - sine * held;
  }
}
const make = round => { const grid = data.map(row => Float64Array.from(row)); if (round > 2) grid[1] = grid; return grid; };
const said = [];
for (let round = 0; round < 5; round++) { const grid = make(round); try { for (let at = 0; at < 4; at++) turn(grid, grid.length, at, 0.5 + round, 0.25); said.push(grid.map(row => row === grid ? "itself" : row === null ? "null" : Array.from(row).map(x => typeof x === "number" ? +x.toFixed(3) : String(x)).join("+")).join(" ")); } catch (error) { said.push(error.name); } }
console.log(said.join("\n"));
