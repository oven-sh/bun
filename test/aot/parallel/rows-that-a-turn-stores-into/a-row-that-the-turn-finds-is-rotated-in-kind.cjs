// The turns of the inner loop find their row and store into it twice: the row is asked once, and behind the first store the rest of the stretch has an arm as written.
// STATISTIC: RowStoreRegionsGuarded >= 1
// STATISTIC: RowStoreRegionsGuarded >= 1
"use strict";
function turned(count, grid, sine, cosine, from, to) { let held; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { held = grid[k][i + 1]; grid[k][i + 1] = sine * grid[k][i] + cosine * held; grid[k][i] = cosine * grid[k][i] - sine * held; } } }
function made(count, step) { const grid = []; for (let k = 0; k < count; k++) { const row = []; for (let i = 0; i < count; i++) row.push(k * 0.5 + i * step + 0.125); grid.push(row); } return grid; }
function shown(grid) { return grid.map(row => Array.from({ length: row.length }, (_, i) => i in row ? (Object.is(row[i], -0) ? "-0" : String(row[i])) : "hole").join(",")).join(";"); }
let sum = 0;
for (let round = 0; round < 300; round++) { const grid = made(6, 0.25 + (round & 3)); turned(6, grid, 0.6, 0.8, 5, 1); sum = (sum + grid[round % 6][round % 5] * 1000) % 1000003; }
console.log(Math.floor(sum));
console.log(shown((() => { const grid = made(4, 0.25); turned(4, grid, 0.6, 0.8, 3, 0); return grid; })()));
