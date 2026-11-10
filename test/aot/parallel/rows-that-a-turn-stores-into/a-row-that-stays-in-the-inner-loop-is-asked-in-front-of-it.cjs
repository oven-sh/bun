// The row stays the same for all the turns of the inner loop: it is asked in front of the loop, never in its turns (asked in the turns, this ran twice as long).
// STATISTIC: RowStoreRegionsGuarded = 0
"use strict";
function cleared(grid) { const count = grid.length; for (let c = 0; c < count; c++) { for (let r = c + 1; r < count; r++) { const factor = grid[r][c] / grid[c][c]; for (let j = c; j <= count; j++) grid[r][j] -= factor * grid[c][j]; } } return grid[count - 1][count]; }
function made(count, step) { const grid = []; for (let r = 0; r < count; r++) { const row = []; for (let j = 0; j <= count; j++) row.push((r * 7 + j * 3) % 11 + step + (r === j ? 100.5 : 0.25)); grid.push(row); } return grid; }
let sum = 0;
for (let round = 0; round < 300; round++) sum = (sum + cleared(made(7, round & 3)) * 1000) % 1000003;
console.log(Math.floor(sum));
