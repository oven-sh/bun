"use strict";
const kept = { id: 1, active: true };
let asked = 0;
const odd = { get id() { asked++; return 7; }, get active() { asked++; return asked % 3 !== 0; } };
const rows = [odd, kept, odd, Object.create(kept), odd];
function sum(turn) { let total = turn; for (let at = 0; at < rows.length; at++) { const row = rows[at]; if (row.active) total = total + row.id; } return total; }
let all = 0;
for (let turn = 0; turn < 300; turn++) all = (all + sum(turn)) % 1000003;
console.log(all, asked);
