"use strict";
// plain: true 8 11
function open(start, count) { let at = start; const close = () => ++at; const out = []; for (let i = 0; i < count; i++) out.push({ f0: () => at + 0, f1: () => at + 1, f2: () => at + 2, f3: () => at + 3, f4: () => at + 4, f5: () => at + 5, f6: () => at + 6, f7: () => at + 7, f8: () => at + 8, f9: () => at + 9, tag: i, close }); return out; }
open(1, 1);
const all = open(+(process.argv[2] ?? 7), 3);
console.log("SAID", all[0].close === all[1].close, all[0].close(), all[2].f3());
