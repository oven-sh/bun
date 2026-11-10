// One row stands at two places of its holder, so two turns find it; between them a turn finds a row whose second value is NaN. That turn puts back what it stored itself and nothing that an earlier turn stored.
// STATISTIC: RowStoreRegionsRestartingIterations >= 1
// STATISTIC: StoresUndoneAtIterationRestarts >= 1
"use strict";
function pushed(...values) { const row = []; for (const value of values) row.push(value); return row; }
function rows() { return pushed(pushed(0.5, 1.5, 2.5, 3.5), pushed(4.5, 5.5, 6.5, 7.5), pushed(8.5, 9.5, 10.5, 11.5), pushed(12.5, 13.5, 14.5, 15.5)); }
function turned(count, grid, sine, cosine, from, to) { let held = -1; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { const row = grid[k]; held = row[i + 1]; row[i + 1] = sine * row[i] + cosine * held; row[i] = cosine * row[i] - sine * held; } } return held; }
const lines = [];
for (let round = 0; round < 40; round++) {
    const grid = rows();
    if (round > 30) { grid[1][1] = Infinity; grid[1][2] = -Infinity; grid[2] = grid[0]; }
    const answer = turned(4, grid, 0.6, -0.8, 2, 1);
    if (round > 37) lines.push(answer + " | " + grid.map(row => row.join()).join(" ; "));
}
console.log(lines.join("\n"));
