// STATISTIC: LoopsLaidOutOnceAKindThatAreComeBackTo >= 5
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3;
function weigh(l, w, x) { let sum = 0; for (let i = 0; i < l.length; i++) { if (l[i] !== x) sum += w[i]; } return sum; }
const l = JSON.parse("[" + Array.from({ length: 200 }, (_, i) => i + 0.5).join() + "]");
const whole = JSON.parse("[" + Array.from({ length: 200 }, (_, i) => i).join() + "]");
const holed = JSON.parse("[" + Array.from({ length: 200 }, (_, i) => i).join() + "]"); for (let i = 9; i < 200; i += 8) delete holed[i];
let s = 0;
for (let t = 0; t < n; t++) { const w = holed; s += (weigh(l, w, 3.5) | 0) + (weigh(l, w, "c") | 0) + (weigh(l, w, 4) | 0); }
console.log(s);
