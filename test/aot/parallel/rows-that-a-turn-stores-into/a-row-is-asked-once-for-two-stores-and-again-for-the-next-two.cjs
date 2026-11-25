// Six stores into the row that the turn finds: a stretch reaches to its second store, so the row is asked three times, and each stretch has one rest as written behind its first store.
// STATISTIC: RowStoreRegionsGuarded >= 3
// STATISTIC: PartialRegionFallbacksEmitted >= 3
"use strict";
function pushed(...values) { const row = []; for (const value of values) row.push(value); return row; }
function scaled(count, grid, factor, from, to) { for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { grid[k][i] = grid[k][i] * factor; grid[k][i + 1] = grid[k][i + 1] * factor + grid[k][i]; grid[k][i + 2] = grid[k][i + 2] * factor; grid[k][i + 3] = grid[k][i + 3] * factor + grid[k][i + 2]; grid[k][i + 4] = grid[k][i + 4] * factor; grid[k][i + 5] = grid[k][i + 5] * factor + grid[k][i + 4]; } } }
function rows() { return pushed(pushed(0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5), pushed(7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5)); }
function listed(row) { let text = ""; for (let i = 0; i < row.length; i++) text += (i in row ? (Object.is(row[i], -0) ? "-0" : String(row[i])) : "hole") + ","; return text + "#" + row.length; }
const lines = [];
for (let round = 0; round < 60; round++) {
    const odd = round % 5 === 4 || round > 40;
    for (let spoiled = -1; spoiled < 7; spoiled++) {
        for (const kind of ["infinity", "hole", "length", "text"]) {
            for (const factor of [0.5, 0, -2, Infinity]) {
                for (const i of [0, 1, 2]) {
                    const grid = rows();
                    if (odd && spoiled >= 0) {
                        if (kind === "infinity") grid[1][spoiled] = -Infinity;
                        else if (kind === "hole") delete grid[1][spoiled];
                        else if (kind === "length") grid[1].length = spoiled;
                        else grid[1][spoiled] = "t";
                    }
                    scaled(2, grid, odd ? factor : 0.5, i + 1, i);
                    if (round === 59) lines.push(spoiled + " " + kind + " " + factor + " " + i + ": " + grid.map(listed).join(" "));
                }
            }
        }
    }
}
console.log(lines.join("\n"));
