// STATISTIC: LoopNestsFullyUnrolled >= 1
"use strict";
function collected(rounds) {
    const made = [];
    for (let round = 0; round < rounds; round++) {
        for (let a = 0; a < 2; a++) {
            for (let b = 0; b < 3; b++) made.push(() => round * 100 + a * 10 + b);
        }
    }
    return made;
}
const printed = [];
for (const one of collected(3)) printed.push(String(one()));
console.log("SAID " + printed.join(" "));
