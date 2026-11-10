// STATISTIC: RowsAskedOnceWhereStretchesStoreIntoThem >= 1
// STATISTIC: RowsAskedOnceWhereStretchesStoreIntoThem >= 1
"use strict";
function pushed(...values) { const row = []; for (const value of values) row.push(value); return row; }
function rows() { return pushed(pushed(0.5, 1.5, 2.5, 3.5, 4.5, 5.5), pushed(6.5, 7.5, 8.5, 9.5, 10.5, 11.5), pushed(12.5, 13.5, 14.5, 15.5, 16.5, 17.5)); }
function turned(count, grid, scale, from, to) { let last = 0; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { const a = grid[k][i]; const less = a < scale; const no = !less; grid[k][i] = a * 2 + 1; const b = grid[k][i + 1] + grid[k][i]; grid[k][i + 1] = b * scale + +!no; last = a + b; } } return last; }
function shown(value) { return typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) : String(value); }
function listed(row) { let text = ""; for (let i = 0; i < row.length; i++) text += (i in row ? shown(row[i]) : "hole") + ","; return text + "#" + row.length; }
const lines = [];
for (let round = 0; round < 60; round++) {
    const odd = round % 5 === 4 || round > 40;
    for (const way of [turned]) {
        for (const scale of [0.5, 2, 10]) {
            for (let spoiled = -1; spoiled < 5; spoiled++) {
                for (const kind of ["infinity", "hole", "length", "text"]) {
                    for (const i of [0, 1, 2]) {
                        const grid = rows();
                        if (odd && spoiled >= 0) {
                            if (kind === "infinity") grid[1][spoiled] = Infinity;
                            else if (kind === "hole") delete grid[1][spoiled];
                            else if (kind === "length") grid[1].length = spoiled;
                            else grid[1][spoiled] = "t";
                        }
                        const last = way(3, grid, odd ? scale : 0.5, i + 1, i);
                        if (round === 59) lines.push(scale + " " + spoiled + " " + kind + " " + i + ": " + shown(last) + " | " + grid.map(listed).join(" "));
                    }
                }
            }
        }
    }
}
console.log(lines.join("\n"));
