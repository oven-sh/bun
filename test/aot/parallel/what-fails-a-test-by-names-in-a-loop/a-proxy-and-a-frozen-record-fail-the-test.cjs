"use strict";
const kept = [{ id: 1, active: true }];
const log = [];
const proxy = new Proxy({ id: 11, active: true }, { get(target, name) { if (log.length < 6) log.push(String(name)); return target[name]; } });
const rows = [proxy, Object.freeze(JSON.parse('{"id":2,"active":true}')), kept[0], proxy];
function sum(turn) { let total = turn, at = 0; while (at < rows.length) { const row = rows[at++]; if (row.active) total = total + row.id; } return total; }
let all = 0;
for (let turn = 0; turn < 300; turn++) all = (all + sum(turn)) % 1000003;
console.log(all, log.join());
