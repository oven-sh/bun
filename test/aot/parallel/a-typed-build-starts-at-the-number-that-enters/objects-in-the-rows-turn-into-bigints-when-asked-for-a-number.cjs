"use strict";
// valueOf gives a bigint: the product is one, and it goes round.
const give = value => ({ valueOf() { return value; } });
const rows = [[give(4n), give(1n)], [give(2n), give(2n)], [give(9n), give(0n)]], plain = JSON.parse('[[4,1],[2,2],[9,0]]');
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
for (let turn = 0; turn < 24; turn++) printed.push(String(ops[steps[0]](turn % 4 === 3 ? rows : plain, (turn % 4 === 3 ? rows : plain).slice(0, 2))));
console.log(printed.join(" "));
