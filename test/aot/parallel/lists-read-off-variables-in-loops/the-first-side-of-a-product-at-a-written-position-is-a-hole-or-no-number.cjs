"use strict";
function dot(a, b) { return a[0] * b[0] - a[1] / b[1] + a[2] * b[2]; }
let first = [1], second = [1];
function sum(start) { let total = start; for (let turn = 0; turn < 20; turn++) total += dot(first, second); return total; }
const said = [];
const kinds = [[0.5, 1.5, 2.5], [1, 2, 3], [0.5, , 2.5], [, 1.5, 2.5], [0.5, 1.5], [], [0.5, "3", 2.5], [0.5, { valueOf() { said.push("asked"); return 4; } }, 2.5], [1n, 2n, 3n], [0.5, null, true], new Float64Array([0.5, 1.5, 2.5]), "123", [0.5, undefined, 2.5]];
for (const a of kinds) for (const b of kinds) {
  first = a; second = b;
  try { said.push(String(sum(0))); } catch (error) { said.push(error.name); }
}
console.log("SAID", said.join(" "));
