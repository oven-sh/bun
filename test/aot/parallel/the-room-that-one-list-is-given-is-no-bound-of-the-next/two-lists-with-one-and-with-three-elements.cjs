"use strict";
// The second is not given the room of the first.
function split(list) { const n = list.length; const one = [list[0]]; const three = [list[0], list[1], list[2]]; for (let i = 1; i < n; i++) { one.push(list[i] - 1); three.push(list[i] + 1); } return [one, three]; }
const data = JSON.parse("[" + Array.from({ length: 40 }, (_, i) => i * 3 + 1).join() + "]");
const said = [];
for (let turn = 0; turn < 5; turn++) { const parts = split(data); said.push(parts.map(part => part.length + ":" + part[0] + ":" + part[part.length - 1] + ":" + part.reduce((sum, x) => sum + x, 0)).join(" ")); }
console.log(said.join(" | "));
