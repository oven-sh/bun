"use strict";
const kept = [{ id: 1, active: true }];
const rows = JSON.parse('[{"id":3,"active":true},{"id":4,"active":false},{"id":5,"active":true}]');
function sum(turn) { let total = turn; for (let at = 0; at < rows.length; at++) { const row = rows[at]; if (row.active) total = total + row.id; } return total; }
let all = 0;
for (let turn = 0; turn < 300; turn++) all = (all + sum(turn)) % 1000003;
console.log(all, kept.length);
