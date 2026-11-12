"use strict";
// The length is asked at every turn, once.
let asked = 0; const kinds = () => [{ 0: 1, 1: 2, 2: 3, get length() { asked++; return 3; } }, { 0: asked, length: 1 }];
function sum(of) { let all = 0; for (let i = 0; i < of.length; i++) all = all + of[i] * 2; return all; }
let kept = null;
function ofFile(turn) { let all = turn & 1; for (let i = 0; i < kept.length; i++) all = all + kept[i] * 2; return all; }
const said = [];
for (let round = 0; round < 3; round++) for (const one of kinds()) { kept = one; try { said.push(String(sum(one)) + "," + String(ofFile(round))); } catch (error) { said.push(error.name); } }
console.log(said.join(" "));
