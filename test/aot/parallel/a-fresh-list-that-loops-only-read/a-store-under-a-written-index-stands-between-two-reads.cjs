// STATISTIC: ElementsOfFreshListsKnownAgain >= 1
"use strict";
// The second read is answered by the first. The written index is the key at one turn in four.
const values = JSON.parse('[["a",1],["b",2],["c",3],["d",4]]');
function thrice(from, rawKey, rawOther) {
    const key = rawKey & 3, other = rawOther & 3;
    const held = [from[0], from[1], from[2]];
    const first = held[key], again = held[key];
    held[1] = from[3];
    const last = held[key];
    return String(first && first[0]) + String(again && again[0]) + String(last && last[0]) + held.length;
}
const ops = { thrice, idle() { return ""; } }, steps = JSON.parse('["thrice"]');
const printed = [];
for (let turn = 0; turn < 32; turn++) printed.push(ops[steps[0]](values, turn, turn >> 2));
console.log(printed.join(" "));
