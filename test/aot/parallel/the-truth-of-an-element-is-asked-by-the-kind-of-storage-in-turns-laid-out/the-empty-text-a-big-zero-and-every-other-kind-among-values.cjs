// STATISTIC: TruthsAskedOfRawElementsInTurnsLaidOut >= 2
// STATISTIC: LoopsLaidOutForWholeNumbersWhoseTruthAloneIsAsked >= 1
"use strict";
// A list of values holds the empty text and one made empty at run time, texts, 0n and 1n, a symbol, null, undefined, both booleans, numbers of every kind, objects, a function and a hole.
const said = [];
function veil(value) { return JSON.parse("0", () => value); }
function count(list) { let c = 0; for (let i = 0; i < list.length; i++) { if (list[i]) c = (c + 1) | 0; } return c; }
for (let round = 0; round < 3; round++) {
    const list = JSON.parse('["a", "", "b"]'); said.push(count(list));
    for (const value of ["", "x".slice(1), "0", " ", 0n, 1n, -1n, BigInt(0), Symbol("s"), null, undefined, true, false, 0, -0, NaN, 1, 0.5, {}, [], function () {}, new String(""), new Number(0), new Boolean(false)]) { list.push(veil(value)); said.push(count(list)); }
    delete list[0]; said.push(count(list));
}
console.log(said.join(" "));
