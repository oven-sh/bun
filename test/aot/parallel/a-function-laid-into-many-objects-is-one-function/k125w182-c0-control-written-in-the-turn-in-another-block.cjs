"use strict";
// plain: false 8 9 5
let calls = 0;
function measure(n) { calls++; return n * 2; }
function open(start, count) { let at = start; const out = []; for (let i = 0; i < count; i++) { const close = () => ++at; if (i & 1) measure(i); out.push({ f0: () => at + 0, f1: () => at + 1, f2: () => at + 2, f3: () => at + 3, f4: () => at + 4, f5: () => at + 5, f6: () => at + 6, f7: () => at + 7, f8: () => at + 8, f9: () => at + 9, step: measure(i), close }); } return out; }
open(1, 1);
const all = open(+(process.argv[2] ?? 7), 3);
console.log("SAID", all[0].close === all[1].close, all[0].close(), all[2].close(), calls);
