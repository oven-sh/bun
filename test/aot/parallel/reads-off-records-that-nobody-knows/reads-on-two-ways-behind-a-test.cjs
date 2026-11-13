"use strict";
const log = [];
const rows = JSON.parse('[' + Array.from({ length: 30 }, (_, i) => `{"kind":${i % 2},"x":${i + 0.5},"y":${i % 4}}`).join() + ']');
function total(rows) { let s = 0; for (const r of rows) { if (r.kind === 1) s += r.x; else s += r.y * 2; } return s; }
for (let turn = 0; turn < 4; turn++) log.push(total(rows));
console.log("SAID", log.join(" | "));
