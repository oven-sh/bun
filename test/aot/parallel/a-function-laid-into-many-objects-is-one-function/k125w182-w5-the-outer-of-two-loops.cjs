"use strict";
// plain: true false 1 2 10
let calls = 0;
function measure(n) { calls++; return n * 2; }
function open(rounds, count) { const out = []; for (let r = 0; r < rounds; r++) { let at = r * 10; const close = () => ++at; for (let i = 0; i < count; i++) out.push({ f0: () => at + 0, f1: () => at + 1, f2: () => at + 2, f3: () => at + 3, f4: () => at + 4, f5: () => at + 5, f6: () => at + 6, f7: () => at + 7, f8: () => at + 8, f9: () => at + 9, step: measure(i), close }); } return out; }
const all = open(2, 2);
console.log("SAID", all[0].close === all[1].close, all[1].close === all[2].close, all[0].close(), all[1].close(), all[3].f0());
