"use strict";
function made(count, width) { const grid = []; for (let k = 0; k < count; k++) { const row = []; for (let i = 0; i < width; i++) row.push(k * 0.5 + i * 0.25 + 0.125); grid.push(row); } return grid; }
function pick(w, j) { return w[j] * 0.5; }
function damped(count, grid, w, gain, from, to) { for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) grid[k][i] = gain * grid[k][i] - pick(w, k); } return grid[1][to]; }
const table = made(24, 12), losses = made(1, 24)[0];
let sum = 0; const rounds = +process.argv[2] || 300;
for (let round = 0; round < rounds; round++) sum = (sum + Math.floor(damped(24, table, losses, 0.8, 8, 4) * 4096)) % 1000003;
console.log(sum, table[5].join());
