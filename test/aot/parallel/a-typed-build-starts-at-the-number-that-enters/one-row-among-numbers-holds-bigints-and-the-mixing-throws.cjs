"use strict";
// A bigint meets a number in a difference: the error comes at the same turn as in plain.
const spots = JSON.parse('[[0.5,1.5],[2.25,0.75],[3.5,3.25],[1.125,2.5]]'), mixed = [spots[0], spots[1], [3n, 4n], spots[3]];
function inner(all, marks) {
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
function nearest(all, marks) { try { return inner(all, marks); } catch (error) { return error.name; } }
const ops = { nearest, idle() { return 0; } }, steps = JSON.parse('["nearest"]');
const printed = [];
for (let turn = 0; turn < 24; turn++) printed.push(String(ops[steps[0]](turn & 1 ? spots : mixed, spots.slice(0, 1 + turn % 3))));
console.log(printed.join(" "));
