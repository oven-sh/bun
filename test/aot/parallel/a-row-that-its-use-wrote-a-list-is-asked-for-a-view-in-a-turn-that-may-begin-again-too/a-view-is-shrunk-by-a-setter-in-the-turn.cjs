"use strict";
// A row over a resizable buffer is shrunk by code that a store into another row runs.
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
const make = turn => { const buffer = new ArrayBuffer(48, { maxByteLength: 48 }), wide = new Float64Array(buffer); wide.set(data[3]); return data.map((row, i) => i === 3 ? wide : i === 0 && turn > 2 ? Object.defineProperty([1, 2, 3, 4], "5", { set() { buffer.resize(16); }, get() { return 9; } }) : Float64Array.from(row)); };
const said = [];
for (let turn = 0; turn < 5; turn++) { const grid = make(turn); said.push(fill(grid, 6, turn + 0.25) + ":" + Array.from(grid[1] ?? []).join("+")); }
console.log(said.join(" | "));
