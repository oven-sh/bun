"use strict";
// plain: f0,f1,f2,f3,f4,f5,f6,f7,f8,f9,step,f10 37 17 14 2
let calls = 0;
function measure(n) { calls++; return n * 2; }
function make(start) { let at = start; return { f0: () => at + 0, f1: () => at + 1, f2: () => at + 2, f3: () => at + 3, f4: () => at + 4, f5: () => at + 5, f6: () => at + 6, f7: () => at + 7, f8: () => at + 8, f9: () => at + 9, step: measure(at), f3: () => at + 30, f10: () => at + 10 }; }
make(1);
const one = make(+(process.argv[2] ?? 7));
console.log("SAID", Object.keys(one).join(), one.f3(), one.f10(), one.step, calls);
