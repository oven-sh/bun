// STATISTIC: SumsSpecializedAsNumbers >= 1
"use strict";
// At one call in three the elements are texts: both sums are texts there.
const list = JSON.parse('[0.5,1.25,2,3.75]'), texts = JSON.parse('["a","b","c"]');
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
for (let turn = 0; turn < 24; turn++) printed.push(String(ops[steps[0]](turn % 3 === 2 ? texts : list, 1 + turn % 4)));
console.log("SAID " + printed.join(" "));
