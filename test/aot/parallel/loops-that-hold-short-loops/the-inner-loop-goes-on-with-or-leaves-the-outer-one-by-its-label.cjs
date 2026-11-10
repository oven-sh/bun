// STATISTIC: LoopsThatHoldLoopsWrittenOut >= 2
"use strict";
function skipped(rows, from) {
    let sum = 0;
    for (let turn = from; turn < from + 4; turn++) {
        outer: for (let a = 0; a < 3; a++) {
            for (let b = 0; b < 3; b++) {
                if ((a + b + turn) % 4 === 0) continue outer;
                sum += rows[a][b] * (turn + 1);
            }
            sum += 1000;
        }
    }
    return sum;
}
function left(rows, from) {
    let sum = 0, last = "";
    for (let turn = from; turn < from + 4; turn++) {
        outer: for (let a = 0; a < 3; a++) {
            for (let b = 0; b < 3; b++) {
                if (rows[a][b] === turn) { last = a + ":" + b; break outer; }
                sum += rows[a][b];
            }
        }
    }
    return sum + " " + last;
}
const rows = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
const printed = [];
for (let from = 0; from < 9; from++) printed.push(skipped(rows, from) + "/" + left(rows, from));
console.log("SAID " + printed.join(" "));
