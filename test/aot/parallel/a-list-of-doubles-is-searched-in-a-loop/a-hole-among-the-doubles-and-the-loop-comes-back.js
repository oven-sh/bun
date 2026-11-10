// STATISTIC: UnrolledLoopsWithSharedReentry >= 5
// Under: --aot-testing=CheckBoundsInEmittersOnly: the turns are laid out as users build them, and every raw access asks its position at the run
// Under: --aot-harden=proof-checks: the kind found in front of the turns is held against the cell at every read
'use strict';
const n = +process.argv[2] || 3; const said = [];
function weigh(l, w, x) { let sum = 0; for (let i = 0; i < l.length; i++) { if (l[i] !== x) sum += w[i]; } return sum; }
const whole = JSON.parse("[" + Array.from({ length: 200 }, (_, i) => i).join() + "]");
const full = JSON.parse("[" + Array.from({ length: 200 }, (_, i) => i + 0.5).join() + "]");
const holed = JSON.parse("[" + Array.from({ length: 200 }, (_, i) => i + 0.5).join() + "]"); delete holed[9];
for (let t = 0; t < n; t++) { said.length = 0; for (const l of [full, holed, full, holed]) said.push(weigh(l, whole, 3.5), weigh(l, whole, "c"), weigh(l, whole, 4), weigh(l, whole, undefined), weigh(l, whole, 150.5)); }
console.log(said.join());
