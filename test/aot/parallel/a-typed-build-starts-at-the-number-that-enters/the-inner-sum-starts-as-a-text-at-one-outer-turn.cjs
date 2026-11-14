"use strict";
// At one outer turn the inner sum starts as a text.
const list = JSON.parse('[0.5,1.25,2,3.75]');
function sums(list, turns) {
    let s = 0;
    for (let k = 0; k < turns; k++) {
        let v = k === 2 ? "" : 0;
        for (let i = 0; i < list.length; i++) v += list[i];
        s += v;
    }
    return s;
}
const ops = { sums, idle() { return 0; } }, steps = JSON.parse('["sums"]');
const printed = [];
for (let turn = 0; turn < 24; turn++) printed.push(String(ops[steps[0]](list, 1 + turn % 5)));
console.log("SAID " + printed.join(" "));
