// STATISTIC: LoopsThatHoldLoopsWrittenOut >= 1
"use strict";
function made(height, width, scale) { return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => ((x * 7 + y * 5) % 11) * scale)); }
const weights = [[0, 1, 0], [1, -4, 1], [0.5, 1, 0]];
function smoothed(grid, weights) {
    let sum = 0;
    for (let y = 1; y < grid.length - 1; y++) {
        for (let x = 1; x < grid[y].length - 1; x++) {
            let here = 0;
            for (let dy = 0; dy < 3; dy++) {
                for (let dx = 0; dx < 3; dx++) here += grid[y + dy - 1][x + dx - 1] * weights[dy][dx];
            }
            sum += Math.abs(here);
        }
    }
    return sum;
}
const printed = [];
for (let turn = 0; turn < 12; turn++) printed.push(String(smoothed(made(5 + turn % 3, 6, turn % 2 ? 0.5 : 1), weights)));
console.log("SAID " + printed.join(" "));
