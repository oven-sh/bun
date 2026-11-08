// STATISTIC: TruthsAskedOfRawElementsInTurnsLaidOut >= 2
// STATISTIC: LoopsLaidOutForWholeNumbersWhoseTruthAloneIsAsked >= 1
"use strict";
// A hole is as false as undefined only while nothing lies under its index above the list: an object laid between the list and Array.prototype holds a number there, then zero, then a getter that changes the list.
const said = [];
function count(list) { let c = 0; for (let i = 0; i < list.length; i++) { if (list[i]) c = (c + 1) | 0; } return c; }
for (let round = 0; round < 3; round++) {
    const whole = JSON.parse("[1,2,3,4,5,6,7,8]"), doubles = JSON.parse("[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5]"); delete whole[3]; delete doubles[3];
    said.push(count(whole), count(doubles));
    const above = Object.create(Array.prototype); Object.setPrototypeOf(whole, above); Object.setPrototypeOf(doubles, above); said.push(count(whole), count(doubles));
    above[3] = 1; said.push(count(whole), count(doubles)); above[3] = 0; said.push(count(whole), count(doubles)); delete above[3];
    let asked = 0;
    Object.defineProperty(above, "3", { configurable: true, get() { asked++; this[5] = 0; return "x"; } }); said.push(count(whole), count(doubles), asked); delete above[3];
    said.push(count(whole), count(doubles)); Object.setPrototypeOf(whole, Array.prototype); said.push(count(whole));
}
console.log(said.join(" "));
