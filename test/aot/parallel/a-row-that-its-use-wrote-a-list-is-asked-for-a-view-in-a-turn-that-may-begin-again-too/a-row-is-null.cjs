"use strict";
// The store throws where it is written.
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
const make = turn => data.map((row, i) => i === 2 && turn > 1 ? null : Float64Array.from(row));
const said = [];
for (let turn = 0; turn < 5; turn++) { const grid = make(turn); try { said.push(fill(grid, 6, turn + 0.25) + ":" + Array.from(grid[1] ?? []).join("+")); } catch (error) { said.push(error.name); } }
console.log(said.join(" | "));
