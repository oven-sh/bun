"use strict";
// The length is inherited, then laid on the object itself.
const above = { length: 2 }; const kinds = () => { const one = Object.create(above); one[0] = 1; one[1] = 2; one[2] = 3; const two = Object.create(above); two[0] = 4; two[1] = 5; two[2] = 6; two.length = 3; return [one, two]; };
function sum(of) { let all = 0; for (let i = 0; i < of.length; i++) all = all + of[i] * 2; return all; }
let kept = null;
function ofFile(turn) { let all = turn & 1; for (let i = 0; i < kept.length; i++) all = all + kept[i] * 2; return all; }
const said = [];
for (let round = 0; round < 3; round++) for (const one of kinds()) { kept = one; try { said.push(String(sum(one)) + "," + String(ofFile(round))); } catch (error) { said.push(error.name); } }
console.log(said.join(" "));
