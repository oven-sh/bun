"use strict";
let calls = 0;
function measure(n) { calls++; return n * 2; }
function makeAll(start, count) { let at = start; const shared = function () { return ++at; }; const out = []; for (let i = 0; i < count; i++) { out.push({ f0: () => at + 0, f1: () => at + 1, f2: () => at + 2, f3: () => at + 3, f4: () => at + 4, f5: () => at + 5, f6: () => at + 6, f7: () => at + 7, f8: () => at + 8, f9: () => at + 9, step: 1, shared }); } return out; }
makeAll(1, 1);
const all = makeAll(+(process.argv[2] ?? 7), 3);
console.log("SAID", all[0].shared === all[1].shared, all[0].shared === all[0].shared, all[0].shared(), all[2].shared(), all[1].f3(), all[2].step, Object.keys(all[0]).join(), calls);
