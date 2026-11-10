// Each turn of the inner loop finds a row and stores into it. In the copy of the loop whose turns may begin again the row is asked once, and no arm as written stands beside the one in kind: what fails begins the turn again in the other copy.
// STATISTIC: RowStoreRegionsRestartingIterations >= 1
"use strict";
function made(count, width) { const grid = []; for (let k = 0; k < count; k++) { const row = []; for (let i = 0; i < width; i++) row.push(k * 0.5 + i * 0.25 + 0.125); grid.push(row); } return grid; }
function damped(count, grid, loss, gain, from, to) { for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) grid[k][i] = gain * grid[k][i] - loss; } return grid[1][to]; }
const table = made(24, 12);
let sum = 0;
for (let round = 0; round < 300; round++) sum = (sum + Math.floor(damped(24, table, 0.6, 0.8, 8, 4) * 4096)) % 1000003;
console.log(sum, table[5].join());
