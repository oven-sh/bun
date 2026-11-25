// STATISTIC: FreshArrayElementReadsEliminated >= 1
// STATISTIC: RetainedObjectFactLossesIgnored >= 1
"use strict";
// The list of three rows is made here and both loops only read it: it stays what it was made as round the outer loop, and the second read of a row under the same key is the first.
const spots = JSON.parse('[[0.5,1.5],[2.25,0.75],[3.5,3.25],[1.125,2.5],[4.75,0.25],[2.5,2.5],[0.25,4.5],[3.75,1.25]]');
function nearest(all, shift) {
    const marks = [all[shift % 8], all[(shift + 3) % 8], all[(shift + 5) % 8]];
    let sum = 0;
    for (const spot of all) {
        let which = 0, least = Infinity;
        for (let m = 0; m < marks.length; m++) {
            const across = spot[0] - marks[m][0], up = spot[1] - marks[m][1], far = across * across + up * up;
            if (far < least) { least = far; which = m; }
        }
        sum = sum * 3 + which;
    }
    return sum;
}
const ops = { nearest, idle() { return 0; } }, steps = JSON.parse('["nearest"]');
let printed = 0;
for (let turn = 0; turn < 40; turn++) printed = (printed + ops[steps[0]](spots, turn)) % 1000003;
console.log(printed);
