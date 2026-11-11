"use strict";
// The first and the second are given nothing.
function split(list) { const n = list.length; const low = []; const even = []; const high = [list[0]]; for (let i = 1; i < n; i++) { low.push(list[i] - 1); even.push(list[i] * 2); high.push(list[i] + 1); } return [low, even, high]; }
const data = JSON.parse("[" + Array.from({ length: 40 }, (_, i) => i * 3 + 1).join() + "]");
const said = [];
for (let turn = 0; turn < 5; turn++) { const parts = split(data); said.push(parts.map(part => part.length + ":" + part[0] + ":" + part[part.length - 1] + ":" + part.reduce((sum, x) => sum + x, 0)).join(" ")); }
console.log(said.join(" | "));
