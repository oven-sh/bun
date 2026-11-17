"use strict";
// Lists, bytes, views, texts, objects, arguments, a function and what has no length.
const kinds = () => [[1.5, 2.5], [1, 2], ["a", 2], new Uint8Array([1, 2]), Buffer.from([3, 4]), new Float64Array([0.5]), "12", JSON.parse('{"0":4,"length":1}'), (function () { return arguments; })(5, 6), function (a, b) {}, {}, new Map(), 7, true];
function sum(of) { let all = 0; for (let i = 0; i < of.length; i++) all = all + of[i] * 2; return all; }
let kept = null;
function ofFile(turn) { let all = turn & 1; for (let i = 0; i < kept.length; i++) all = all + kept[i] * 2; return all; }
const said = [];
for (let round = 0; round < 3; round++) for (const one of kinds()) { kept = one; try { said.push(String(sum(one)) + "," + String(ofFile(round))); } catch (error) { said.push(error.name); } }
console.log(said.join(" "));
