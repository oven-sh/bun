"use strict";
// plain: true false x 8 8
const extra = JSON.parse('{"kind":"x"}');
function open(start, count) { let at = start; const close = () => ++at; const out = []; for (let i = 0; i < count; i++) out.push({ read: () => at, ...extra, close }); return out; }
open(1, 1);
const all = open(+(process.argv[2] ?? 7), 3);
console.log("SAID", all[0].close === all[1].close, all[0].read === all[1].read, all[1].kind, all[0].close(), all[2].read());
