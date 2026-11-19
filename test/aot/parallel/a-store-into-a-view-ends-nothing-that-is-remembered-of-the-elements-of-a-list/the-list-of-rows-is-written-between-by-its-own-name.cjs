"use strict";
// A store into the list of rows between the reads ends what was known, beside stores into views.
const data = JSON.parse("[" + Array.from({ length: 6 }, (_, i) => "[" + Array.from({ length: 6 }, (_, j) => (i * 6 + j) / 4).join() + "]").join() + "]");
function swap(grid, side) {
  let sum = 0;
  for (let k = 0; k + 1 < side; k++) {
    const row = grid[k];
    row[0] = k;
    grid[k] = grid[k + 1];
    grid[k][1] = k + 0.5;
    sum += grid[k][0] + grid[k][1] + row[1];
    grid[k + 1] = row;
  }
  return sum;
}
const said = [];
for (let round = 0; round < 5; round++) { const grid = data.map(row => Float64Array.from(row)); said.push(swap(grid, 6), Array.from(grid[5]).join("+")); }
console.log(said.join(" "));
