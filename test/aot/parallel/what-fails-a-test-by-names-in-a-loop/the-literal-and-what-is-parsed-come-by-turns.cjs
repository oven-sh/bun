"use strict";
const rows = [];
for (let at = 0; at < 40; at++) rows.push(at & 1 ? { id: at, active: at % 3 !== 0 } : JSON.parse('{"active":' + (at % 5 !== 0) + ',"id":' + at * 2 + "}"));
function sum(turn) { let total = turn; for (const row of rows) { if (!row.active) continue; total = total + row.id; } return total; }
let all = 0;
for (let turn = 0; turn < 300; turn++) all = (all + sum(turn)) % 1000003;
console.log(all);
