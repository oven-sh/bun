"use strict";
// The start of what goes round is handed in.
const rows = JSON.parse('[[4,1],[2,2],[9,0],[1,7]]'), large = [[4n, 1n], [2n, 2n]];
function nearest(all, start) {
    let least = start, count = 0;
    for (const row of all) {
        for (let k = 0; k < row.length; k++) { const twice = row[k] * row[k]; if (twice < least) { least = twice; count++; } }
    }
    return String(least) + typeof least + count;
}
const ops = { nearest, idle() { return 0; } }, steps = JSON.parse('["nearest"]');
const printed = [];
for (let turn = 0; turn < 24; turn++) printed.push(String(ops[steps[0]](turn % 3 === 2 ? large : rows, turn % 5 === 4 ? 50n : 50)));
console.log(printed.join(" "));
