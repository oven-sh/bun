"use strict";
// One row is an object whose index has a setter that replaces the row in the list of rows.
const data = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => "[" + Array.from({ length: 6 }, (_, j) => (i * 6 + j) / 4).join() + "]").join() + "]");
function turn(grid, side, at, sine, cosine) {
  for (let k = 0; k < side; k++) {
    const held = grid[k][at + 1];
    grid[k][at + 1] = sine * grid[k][at] + cosine * held;
    grid[k][at] = cosine * grid[k][at] - sine * held;
  }
}
const make = round => { const grid = data.map(row => Float64Array.from(row)); if (round > 1) grid[4] = Object.defineProperty({ 0: 1, 2: 3, 3: 4, 4: 5, length: 5 }, "1", { set(value) { grid[4] = new Float64Array(6).fill(value); }, get() { return 2; } }); return grid; };
const said = [];
for (let round = 0; round < 5; round++) { const grid = make(round); try { for (let at = 0; at < 4; at++) turn(grid, grid.length, at, 0.5 + round, 0.25); said.push(grid.map(row => row === grid ? "itself" : row === null ? "null" : Array.from(row).map(x => typeof x === "number" ? +x.toFixed(3) : String(x)).join("+")).join(" ")); } catch (error) { said.push(error.name); } }
console.log(said.join("\n"));
