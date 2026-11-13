"use strict";
const kept = [{ seen: 0, weight: 2 }];
const rows = JSON.parse('[{"seen":0,"weight":3},{"weight":4,"seen":1},{"seen":2,"weight":5,"more":1}]');
function mark(turn) { let total = 0; for (let at = 0; at < rows.length; at++) { const row = rows[at]; row.seen = row.seen + row.weight + (turn & 1); total = total + row.seen; } return total; }
let all = 0;
for (let turn = 0; turn < 300; turn++) all = (all + mark(turn)) % 1000003;
console.log(all, JSON.stringify(rows), kept[0].seen);
