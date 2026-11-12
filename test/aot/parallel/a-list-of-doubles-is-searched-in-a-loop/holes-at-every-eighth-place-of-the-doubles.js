// STATISTIC: UnrolledLoopsWithSharedReentry >= 3
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3; const said = [];
function weigh(l, w, x) { let sum = 0; for (let i = 0; i < l.length; i++) { if (l[i] !== x) sum += w[i]; } return sum; }
const whole = JSON.parse("[" + Array.from({ length: 200 }, (_, i) => i).join() + "]");
const full = JSON.parse("[" + Array.from({ length: 200 }, (_, i) => i + 0.5).join() + "]");
const holed = JSON.parse("[" + Array.from({ length: 200 }, (_, i) => i + 0.5).join() + "]"); for (let i = 9; i < 200; i += 8) delete holed[i];
for (let t = 0; t < n; t++) { said.length = 0; for (const l of [full, holed, full, holed]) said.push(weigh(l, whole, 3.5), weigh(l, whole, "c"), weigh(l, whole, 4), weigh(l, whole, undefined), weigh(l, whole, 150.5)); }
console.log(said.join());
