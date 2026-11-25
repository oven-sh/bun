"use strict";
// plain: true false 14 8 8
function open(start, count) { let at = start; const close = () => ++at; const out = []; for (let i = 0; i < count; i++) out.push({ read: () => at, get size() { return at * 2; }, close }); return out; }
open(1, 1);
const all = open(+(process.argv[2] ?? 7), 3);
console.log("SAID", all[0].close === all[1].close, all[0].read === all[1].read, all[1].size, all[0].close(), all[2].read());
