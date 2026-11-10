"use strict";
// The sine is an object in late rounds: Symbol.toPrimitive lays another row into the list of rows between the reads.
const data = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => "[" + Array.from({ length: 6 }, (_, j) => (i * 6 + j) / 4).join() + "]").join() + "]");
function turn(grid, side, at, sine, cosine) {
  for (let k = 0; k < side; k++) {
    const held = grid[k][at + 1];
    grid[k][at + 1] = sine * grid[k][at] + cosine * held;
    grid[k][at] = cosine * grid[k][at] - sine * held;
  }
}
const show = grid => grid.map(row => { try { return Array.from(row, x => typeof x === "number" ? +x.toFixed(3) : String(x)).join("+"); } catch (error) { return error.name; } }).join(" ");
const said = [];
for (let round = 0; round < 6; round++) {
  const hostile = round > 2;
  let grid = data.map(row => Float64Array.from(row));
  const SINE = hostile ? { [Symbol.toPrimitive]() { grid[3] = new Float64Array(6).fill(round); return 2; } } : 0.5 + round;
  try { for (let at = 0; at < 4; at++) turn(grid, grid.length, at, SINE, 0.25); said.push(show(grid)); } catch (error) { said.push(error.name + " " + show(grid)); }
}
console.log(said.join("\n"));
