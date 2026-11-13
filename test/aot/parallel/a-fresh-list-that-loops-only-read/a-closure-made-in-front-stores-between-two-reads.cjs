"use strict";
// The closure names the list: it is called between the reads.
const values = JSON.parse('[["a",1],["b",2],["c",3],["d",4]]');
const runs = [(run, what) => run(what), () => { }];
function thrice(from, rawKey, rawOther) {
    const key = rawKey & 3, other = rawOther & 3;
    const held = [from[0], from[1], from[2]];
    const lay = what => { held[key] = what; };
    const first = held[key], again = held[key];
    runs[other & 1](lay, from[3]);
    const last = held[key];
    return String(first && first[0]) + String(again && again[0]) + String(last && last[0]);
}
const ops = { thrice, idle() { return ""; } }, steps = JSON.parse('["thrice"]');
const printed = [];
for (let turn = 0; turn < 32; turn++) printed.push(ops[steps[0]](values, turn, turn >> 2));
console.log(printed.join(" "));
