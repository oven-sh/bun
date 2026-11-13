"use strict";
// The holder is no list: its length is an ordinary field.
const kinds = () => [JSON.parse('{"0":0.5,"1":1.5,"2":2.5,"length":3}')];
function sum(of) { let all = 0; for (let i = 0; i < of.length; i++) all = all + of[i] * 2; return all; }
let kept = null;
function ofFile(turn) { let all = turn & 1; for (let i = 0; i < kept.length; i++) all = all + kept[i] * 2; return all; }
const said = [];
for (let round = 0; round < 3; round++) for (const one of kinds()) { kept = one; try { said.push(String(sum(one)) + "," + String(ofFile(round))); } catch (error) { said.push(error.name); } }
console.log(said.join(" "));
