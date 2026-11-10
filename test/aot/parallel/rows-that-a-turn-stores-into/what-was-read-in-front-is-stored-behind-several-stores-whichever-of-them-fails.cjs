// Four places of the row are read first and stored afterwards, each value behind one store more: where the second, third or fourth store fails, the rest runs as written with what was read in front, and nothing is read or stored twice.
// STATISTIC: RowStoreRegionsGuarded >= 1
// STATISTIC: RowStoreRegionsGuarded >= 1
"use strict";
function pushed(...values) { const row = []; for (const value of values) row.push(value); return row; }
function rows() { return pushed(pushed(0.5, 1.5, 2.5, 3.5, 4.5, 5.5), pushed(6.5, 7.5, 8.5, 9.5, 10.5, 11.5), pushed(12.5, 13.5, 14.5, 15.5, 16.5, 17.5)); }
function shifted(count, grid, scale, from, to) { let last = 0; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { const a = grid[k][i], b = grid[k][i + 1], c = grid[k][i + 2], d = grid[k][i + 3]; grid[k][i] = b * scale + 1; grid[k][i + 1] = c * scale + a; grid[k][i + 2] = d * scale + b; grid[k][i + 3] = a * scale + c; last = a + b + c + d; } } return last; }
function mixed(count, grid, scale, from, to) { let last = 0; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { const a = grid[k][i]; grid[k][i] = a * 2 + 1; const b = grid[k][i + 1] + grid[k][i]; grid[k][i + 1] = b * scale; const c = grid[k][i + 2] + a + b; grid[k][i + 2] = c * scale + grid[k][i + 1]; last = a + b + c + grid[k][i]; } } return last; }
function shown(value) { return typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) : String(value); }
function listed(row) { let text = ""; for (let i = 0; i < row.length; i++) text += (i in row ? shown(row[i]) : "hole") + ","; return text + "#" + row.length; }
const lines = [];
for (let round = 0; round < 60; round++) {
    const odd = round % 5 === 4 || round > 40;
    for (const way of [shifted, mixed]) {
        for (const scale of [0.5, 0, -2, Infinity, NaN]) {
            for (let spoiled = -1; spoiled < 6; spoiled++) {
                for (const kind of ["infinity", "minus", "hole", "length", "text"]) {
                    for (const i of [0, 1, 2, 3]) {
                        const grid = rows();
                        if (odd && spoiled >= 0) {
                            if (kind === "infinity") grid[1][spoiled] = Infinity;
                            else if (kind === "minus") grid[1][spoiled] = -Infinity;
                            else if (kind === "hole") delete grid[1][spoiled];
                            else if (kind === "length") grid[1].length = spoiled;
                            else grid[1][spoiled] = "t";
                        }
                        const last = way(3, grid, odd ? scale : 0.5, i + 1, i);
                        if (round === 59) lines.push(way.name + " " + scale + " " + spoiled + " " + kind + " " + i + ": " + shown(last) + " | " + grid.map(listed).join(" "));
                    }
                }
            }
        }
    }
}
console.log(lines.join("\n"));
