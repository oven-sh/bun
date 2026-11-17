"use strict";
// A getter under an index shortens the holder.
const kinds = () => { const one = { 0: 1, 2: 3, 3: 4, length: 4 }; Object.defineProperty(one, "1", { get() { one.length = 3; return 2; }, configurable: true }); return [one]; };
function sum(of) { let all = 0; for (let i = 0; i < of.length; i++) all = all + of[i] * 2; return all; }
let kept = null;
function ofFile(turn) { let all = turn & 1; for (let i = 0; i < kept.length; i++) all = all + kept[i] * 2; return all; }
const said = [];
for (let round = 0; round < 3; round++) for (const one of kinds()) { kept = one; try { said.push(String(sum(one)) + "," + String(ofFile(round))); } catch (error) { said.push(error.name); } }
console.log(said.join(" "));
