"use strict";
// STATISTIC: CodeUnitsPassedToStringFromCharCode >= 3
// String.fromCharCode() of an unknown value, in loops: joined, kept, compared, with values that convert, throw and run code.
function join(list) { let text = ""; for (let i = 0; i < list.length; i++) text += String.fromCharCode(list[i]); return text; }
function keep(list) { const all = []; for (const value of list) all.push(String.fromCharCode(value)); return all.join("\u0001"); }
function count(list, c) { let n = 0; for (let i = 0; i < list.length; i++) { if (String.fromCharCode(list[i]) === c) n++; } return n; }
function mixed(list) { let text = "<"; for (let i = 0; i < list.length; i++) { const c = String.fromCharCode(list[i]); text += c + c.length + (c < "c" ? "-" : "+"); } return text; }
const unseen = JSON.parse('{"list":[]}');
let ran = 0;
const odd = { valueOf() { ran++; return 66; } };
const lists = [[72, 105], [72.9, -1, 65536 + 97, 2 ** 32 + 98, 2 ** 53, NaN, Infinity, -0, 0.5], ["99", "x", "", null, undefined, true, false, [100], {}], [odd, 67, odd], [1, , 3], new Uint8Array([65, 66, 255]), new Float64Array([97.5, -1]), [0x4e2d, 0xd83d, 0xde00], [new Date(101), "0x66", " 103 "]];
const answers = [];
const tried = run => { try { return run(); } catch (error) { return error.constructor.name + ": " + error.message; } };
for (let round = 0; round < 3; round++) {
  for (const list of [...lists, [65, Symbol.iterator], [65, 10n], [{ valueOf() { throw new RangeError("no"); } }], [{ [Symbol.toPrimitive]: () => "104" }]]) {
    unseen.list = list;
    for (const run of [() => join(unseen.list), () => keep(unseen.list), () => count(unseen.list, "B"), () => mixed(unseen.list)]) answers.push(escape(String(tried(run))));
  }
}
console.log(answers.join("\n"), ran);
