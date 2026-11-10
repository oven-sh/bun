"use strict";
let calls = 0;
function measure(n) { calls++; return n * 2; }
function make(start) { let at = start; const shared = function () { return ++at; }; return { f0: () => at + 0, f1: () => at + 1, f2: () => at + 2, f3: () => at + 3, f4: () => at + 4, f5: () => at + 5, f6: () => at + 6, f7: () => at + 7, f8: () => at + 8, f9: () => at + 9, step: measure(at), shared }; }
const all = [make(+(process.argv[2] ?? 7)), make(8), make(9)];
console.log("SAID", all[0].shared === all[1].shared, all[0].shared === all[0].shared, all[0].shared(), all[2].shared(), all[1].f3(), all[2].step, Object.keys(all[0]).join(), calls);
