// The turn names the row that it finds and stores into it twice. In one row the first value is a number and the second is NaN, which no list of raw numbers holds: the first store is put back and the turn begins again in the other copy of the loop.
// STATISTIC: RowsAskedOnceWhereTurnsBeginAgain >= 1
// STATISTIC: StoresPutBackWhereTurnsBeginAgain >= 1
"use strict";
function pushed(...values) { const row = []; for (const value of values) row.push(value); return row; }
function rows() { return pushed(pushed(0.5, 1.5, 2.5, 3.5), pushed(4.5, 5.5, 6.5, 7.5), pushed(8.5, 9.5, 10.5, 11.5), pushed(12.5, 13.5, 14.5, 15.5)); }
function turned(count, grid, sine, cosine, from, to) { let held = -1; for (let i = from - 1; i >= to; i--) { for (let k = 0; k < count; k++) { const row = grid[k]; held = row[i + 1]; row[i + 1] = sine * row[i] + cosine * held; row[i] = cosine * row[i] - sine * held; } } return held; }
const lines = [];
for (let round = 0; round < 40; round++) {
    const grid = rows();
    if (round > 30) { grid[1][1] = Infinity; grid[1][2] = -Infinity; }
    const answer = turned(4, grid, 0.6, -0.8, 2, 1);
    if (round > 37) lines.push(answer + " | " + grid.map(row => row.join()).join(" ; "));
}
console.log(lines.join("\n"));
