"use strict";
// Asking a small view for its buffer moves its bytes: what the turn knows of the view's vector must not outlive that.
const data = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => "[" + Array.from({ length: 6 }, (_, j) => (i * 6 + j) / 4).join() + "]").join() + "]");
const kept = [];
function turn(grid, side, at, sine, cosine) {
  for (let k = 0; k < side; k++) {
    const held = grid[k][at + 1];
    grid[k][at + 1] = grid[k][at] * sine + held / 2;
    kept.push(grid[k].buffer);
    grid[k][at] = (held - grid[k][at]) * cosine;
  }
}
function named(grid, side, at, sine, cosine) {
  for (let k = 0; k < side; k++) {
    const row = grid[k], held = row[at + 1];
    row[at + 1] = row[at] * sine + held / 2;
    kept.push(row.buffer);
    row[at] = (held - row[at]) * cosine;
  }
}
const said = [];
for (const way of [turn, named]) for (let round = 0; round < 4; round++) {
  const grid = data.map(row => Float64Array.from(row));
  for (let at = 0; at < 4; at++) way(grid, grid.length, at, 0.5 + round, 0.25);
  said.push(grid.map((row, k) => Array.from(row, x => +x.toFixed(3)).join("+") + "=" + Array.from(new Float64Array(row.buffer), x => +x.toFixed(3)).join("+")).join(" "));
}
console.log(said.join("\n"), kept.length);
