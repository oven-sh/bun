"use strict";
const kept = [{ id: 1, active: true }];
const rows = [JSON.parse('{"id":3,"active":true}'), null, 5, "text", kept[0], undefined, JSON.parse('{"id":9,"active":1}')];
function sum(turn) { let total = turn, thrown = 0; for (let at = 0; at < rows.length; at++) { try { const row = rows[at]; if (row.active) total = total + row.id; } catch (error) { thrown += error instanceof TypeError ? 1 : 100; } } return total * 10 + thrown; }
let all = 0;
for (let turn = 0; turn < 300; turn++) all = (all + sum(turn)) % 1000003;
console.log(all);
