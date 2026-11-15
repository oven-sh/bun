// STATISTIC: UnrolledLoopRawTruthinessTests >= 2
// STATISTIC: UnrolledLoopsForInt32Truthiness >= 1
"use strict";
// A list of whole numbers holds 0, the least and the greatest int32, -1 and holes: the word as it lies is asked; the empty word of a hole is as false as undefined.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
function count(list) { let c = 0; for (let i = 0; i < list.length; i++) { if (list[i]) c = (c + 1) | 0; } return c; }
for (let round = 0; round < 3; round++) {
    const list = JSON.parse("[" + Array.from({ length: 40 }, (_, i) => i + 1).join() + "]"); said.push(count(list));
    list[1] = veil(0); said.push(count(list)); list[2] = veil(-2147483648); list[3] = veil(2147483647); list[4] = veil(-1); said.push(count(list));
    delete list[5]; said.push(count(list)); delete list[39]; delete list[0]; said.push(count(list)); list.length = 45; said.push(count(list)); list.length = 3; said.push(count(list));
    list.length = 0; said.push(count(list)); list.push(veil(0), veil(0), veil(65536), veil(0)); said.push(count(list));
}
console.log(said.join(" "));
