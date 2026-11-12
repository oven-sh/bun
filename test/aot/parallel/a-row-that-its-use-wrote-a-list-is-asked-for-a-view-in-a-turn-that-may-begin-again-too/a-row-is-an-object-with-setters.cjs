"use strict";
// An object whose index has a setter takes the store.
function fill(grid, side, weight) {
  let sum = 0;
  for (let round = 1; round < side; round++) {
    for (let j = 0; j < round; j++) {
      grid[j][round] = weight + j;
      let held = grid[j][j] * weight;
      for (let k = j + 1; k < round; k++) held += grid[k][j] * 0.5;
      sum += held;
    }
  }
  return sum;
}
const data = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => "[" + Array.from({ length: 6 }, (_, j) => (i * 6 + j) / 4).join() + "]").join() + "]");
let taken = 0; const make = turn => data.map((row, i) => i === 1 && turn > 1 ? Object.defineProperty({ 0: 1, 1: 2, 2: 3, length: 3 }, "4", { set(value) { taken += value; }, get() { return taken; } }) : Float64Array.from(row));
const said = [];
for (let turn = 0; turn < 5; turn++) { const grid = make(turn); said.push(fill(grid, 6, turn + 0.25) + ":" + Array.from(grid[1] ?? []).join("+")); }
console.log(said.join(" | "));
