"use strict";
// The same text is handed rows of bigints at one call in three: what goes round is a bigint there.
const spots = JSON.parse('[[0.5,1.5],[2.25,0.75],[3.5,3.25],[1.125,2.5]]'), large = [[1n, 5n], [7n, 2n], [3n, 3n], [9n, 1n]];
function nearest(all, marks) {
    let sum = 0;
    for (const spot of all) {
        let which = 0, least = Infinity;
        for (let m = 0; m < marks.length; m++) {
            const across = spot[0] - marks[m][0], up = spot[1] - marks[m][1], far = across * across + up * up;
            if (far < least) { least = far; which = m; }
        }
        sum = sum * 3 + which + (typeof least === "bigint" ? 1000 : 0);
    }
    return sum;
}
const ops = { nearest, idle() { return 0; } }, steps = JSON.parse('["nearest"]');
const printed = [];
for (let turn = 0; turn < 24; turn++) printed.push(String(ops[steps[0]](turn % 3 ? spots : large, (turn % 3 ? spots : large).slice(turn & 1, 3))));
console.log(printed.join(" "));
