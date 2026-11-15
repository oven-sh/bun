"use strict";
// What is stored into the view is an object: its valueOf runs in the store and replaces the row that is read next.
const data = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => "[" + Array.from({ length: 6 }, (_, j) => (i * 6 + j) / 4).join() + "]").join() + "]");
function lay(grid, side, stored) {
  let sum = 0;
  for (let k = 0; k < side; k++) {
    const first = grid[k][0];
    grid[k][1] = stored;
    sum += grid[k][0] - first + grid[k][1];
  }
  return sum;
}
const said = [];
for (let round = 0; round < 6; round++) { const grid = data.map(row => Float64Array.from(row)); said.push(lay(grid, 6, round > 3 ? { valueOf() { for (let k = 0; k < 6; k++) grid[k] = new Float64Array(6).fill(100 + round); return 7; } } : round)); }
console.log(said.join(" "));
