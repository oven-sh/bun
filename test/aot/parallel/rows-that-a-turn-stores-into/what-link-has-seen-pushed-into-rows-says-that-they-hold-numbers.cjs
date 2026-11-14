// A swap computes nothing with what it moves, so no text of the function says what the rows hold; Link has seen that fractions alone are pushed into them. That is enough to ask the row once for raw numbers.
// STATISTIC: RowStoreRegionsGuarded >= 1
"use strict";
function made(count, width, start) { const grid = []; for (let k = 0; k < count; k++) { const row = []; for (let i = 0; i < width; i++) row.push(k * 0.5 + i * 0.25 + start); grid.push(row); } return grid; }
function swapped(grid, a, b) { for (let j = 0; j < grid.length; j++) { const held = grid[j][a]; grid[j][a] = grid[j][b]; grid[j][b] = held; } }
const table = made(24, 12, 0.125);
let sum = 0;
for (let round = 0; round < 400; round++) { swapped(table, round % 12, (round * 7) % 12); sum = (sum + Math.floor(table[round % 24][3] * 64)) % 1000003; }
console.log(sum, table[5].join());
