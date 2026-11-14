"use strict";
// The list of numbers takes a text in an outer turn: the outer sum is a number for two turns and a text from the third.
const made = () => JSON.parse('[0.5,1.25,2,3.75]');
function sums(list, turns) {
    let s = 0;
    for (let k = 0; k < turns; k++) {
        let v = 0;
        for (let i = 0; i < list.length; i++) v += list[i];
        s += v;
        if (k === 1 && turns > 3) list[2] = "z";
    }
    return s;
}
const ops = { sums, idle() { return 0; } }, steps = JSON.parse('["sums"]');
const printed = [];
for (let turn = 0; turn < 24; turn++) printed.push(String(ops[steps[0]](made(), 1 + turn % 6)));
console.log("SAID " + printed.join(" "));
