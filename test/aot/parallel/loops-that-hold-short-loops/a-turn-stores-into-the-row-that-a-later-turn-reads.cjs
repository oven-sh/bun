// STATISTIC: LoopNestsFullyUnrolled >= 1
"use strict";
function spread(table, other, stored) {
    let sum = 0;
    for (let round = 0; round < stored.length; round++) {
        for (let a = 0; a < 3; a++) {
            for (let b = 0; b < 3; b++) {
                sum += table[a][b];
                other[(a + 1) % 3][b] = stored[round];
            }
        }
    }
    return sum;
}
const printed = [];
for (const stored of [[7], [7, 0.25], [7, 0.25, "t"], [undefined, 3]]) {
    const table = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    printed.push(String(spread(table, table, stored)), JSON.stringify(table));
    const apart = [[1, 2, 3], [4, 5, 6], [7, 8, 9]], other = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    printed.push(String(spread(apart, other, stored)), JSON.stringify(other));
}
console.log("SAID " + printed.join(" "));
