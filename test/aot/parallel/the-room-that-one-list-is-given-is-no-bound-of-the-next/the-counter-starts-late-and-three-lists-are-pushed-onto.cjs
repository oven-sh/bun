"use strict";
// The turns that are left are counted from where the counter enters, for each list anew.
function split(list) { const n = list.length; const a = [list[0], list[1]]; const b = [list[2]]; const c = [list[3], list[4], list[5], list[6]]; for (let i = 7; i < n; i++) { a.push(list[i]); b.push(list[i] + 0.5); c.push(-list[i]); } return [a, b, c]; }
const data = JSON.parse("[" + Array.from({ length: 300 }, (_, i) => i * 3 + 1).join() + "]");
const said = [];
for (let turn = 0; turn < 5; turn++) { const parts = split(data); said.push(parts.map(part => part.length + ":" + part[0] + ":" + part[part.length - 1] + ":" + part.reduce((sum, x) => sum + x, 0)).join(" ")); }
console.log(said.join(" | "));
