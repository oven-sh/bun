// STATISTIC: TruthsAskedOfRawElementsInTurnsLaidOut >= 2
// STATISTIC: LoopsLaidOutForWholeNumbersWhoseTruthAloneIsAsked >= 1
"use strict";
// A list of doubles holds 0, -0, a NaN that was reckoned, a NaN of other bits out of a view, a hole, the least number there is and both infinities: each is as true as the read would have found it.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
function count(list) { let c = 0; for (let i = 0; i < list.length; i++) { if (list[i]) c = (c + 1) | 0; } return c; }
const bits = new Float64Array(1); new Uint32Array(bits.buffer).set([1, 0x7ff80000]);
for (let round = 0; round < 3; round++) {
    const list = JSON.parse("[" + Array.from({ length: 40 }, (_, i) => i + 0.5).join() + "]"); said.push(count(list));
    list[1] = veil(0); said.push(count(list)); list[2] = veil(-0); said.push(count(list)); list[3] = veil(0 / 0); said.push(count(list)); list[4] = veil(bits[0]); said.push(count(list));
    delete list[5]; said.push(count(list)); list[6] = veil(5e-324); list[7] = veil(Infinity); list[8] = veil(-Infinity); said.push(count(list));
    delete list[39]; delete list[0]; said.push(count(list)); list.length = 45; said.push(count(list)); list.length = 3; said.push(count(list));
}
console.log(said.join(" "));
