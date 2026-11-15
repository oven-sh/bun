"use strict";
// Two thousand turns: every element is there.
function split(list) { const n = list.length; const three = [list[0], list[1], list[2]]; const one = [list[0]]; for (let i = 1; i < n; i++) { three.push(list[i] + 1); one.push(list[i] - 1); } return [three, one]; }
const data = JSON.parse("[" + Array.from({ length: 2000 }, (_, i) => i * 3 + 1).join() + "]");
const said = [];
for (let turn = 0; turn < 5; turn++) { const parts = split(data); said.push(parts.map(part => part.length + ":" + part[0] + ":" + part[part.length - 1] + ":" + part.reduce((sum, x) => sum + x, 0)).join(" ")); }
console.log(said.join(" | "));
