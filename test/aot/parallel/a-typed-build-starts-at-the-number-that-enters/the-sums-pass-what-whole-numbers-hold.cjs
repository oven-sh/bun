// STATISTIC: SumsSpecializedAsNumbers >= 1
"use strict";
// The sums grow beyond 2^31 and 2^53.
const list = JSON.parse('[2147483647,2147483647,9007199254740991]');
function sums(list, turns) {
    let s = 0;
    for (let k = 0; k < turns; k++) {
        let v = 0;
        for (let i = 0; i < list.length; i++) v += list[i];
        s += v;
    }
    return s;
}
const ops = { sums, idle() { return 0; } }, steps = JSON.parse('["sums"]');
const printed = [];
for (let turn = 0; turn < 24; turn++) printed.push(String(ops[steps[0]](list, 1 + turn % 6)));
console.log("SAID " + printed.join(" "));
