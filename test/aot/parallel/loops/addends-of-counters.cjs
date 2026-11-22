// What an iteration adds to its counter to store the sum is no step of the counter: nothing asks it for an integer before the loop, and fractions, large numbers, strings and objects answer as they do in order.
// STATISTIC: KeyStepGuardsHoisted = 0
"use strict";
function triangle(grid, side, weight) { let sum = 0; for (let round = 1; round < side; round++) for (let j = 0; j < round; j++) { grid[j][round] = weight + j; let held = grid[j][j] * weight; for (let k = j + 1; k < round; k++) held += grid[k][j] * 0.5; sum += held; } return sum; }
function ramp(list, n, base) { for (let i = 0; i < n; i++) list[i] = base + i; return list[n - 1]; }
function down(list, n, base) { for (let i = 0; i < n; i++) list[i] = base - i; return list[n - 1]; }
function both(a, b, n, base) { let last = 0; for (let i = 0; i < n; i++) { const value = base + i; a[i] = value; last = b[i] = value * 2; } return last; }
function nested(grid, rows, columns, base) { for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) grid[y][x] = base + x; return grid[rows - 1][columns - 1]; }
function chosen(list, n, base) { for (let i = 0; i < n; i++) list[i] = i & 1 ? base + i : i; return list[n - 1]; }
const show = value => Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value);
const attempt = run => { try { return show(run()); } catch (error) { return error.name; } };
const rows = JSON.parse("[[1,2,3,4,5,6],[0.5,1.5,2.5,3.5,4.5,5.5],[1,2,3,4,5,6],[0,0,0,0,0,0],[9,8,7,6,5,4],[3,1,4,1,5,9]]");
const grids = [() => rows.map(row => row.slice()), () => rows.map(row => Float64Array.from(row)), () => rows.map((row, i) => i & 1 ? Int32Array.from(row) : row.slice()), () => rows.map((row, i) => i === 3 ? [] : row.slice()), () => rows.map(row => Object.freeze(row.slice()))];
const bases = [0.25, 3, -0, 2147483640, 9007199254740990, NaN, Infinity, "a", null, undefined, { valueOf() { return 0.5; } }, 3n];
for (const base of bases) {
  for (const make of grids) console.log([() => triangle(make(), 6, base), () => nested(make(), 6, 6, base), () => ramp(make()[1], 6, base), () => down(make()[2], 6, base), () => both(make()[0], make()[1], 6, base), () => chosen(make()[4], 6, base)].map(attempt).join(" "));
  console.log([() => ramp([], 12, base), () => down([], 12, base), () => both([], [], 12, base), () => chosen([], 12, base), () => ramp(new Uint8Array(5), 5, base), () => ramp(new Float32Array(5), 9, base), () => ramp({}, 3, base), () => ramp(null, 1, base)].map(attempt).join(" "));
}
