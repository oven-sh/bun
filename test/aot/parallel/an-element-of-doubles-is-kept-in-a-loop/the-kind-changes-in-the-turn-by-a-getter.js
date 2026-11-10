// Under: --aot-harden=proof-checks: what the arm reads is asked of the cell again
'use strict';
const fresh = () => JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5]"); const whole = () => JSON.parse("[1,2,3,4,5,6,7,8]"); const n = +process.argv[2] || 3; let kept; const said = [];
function f(l, o) { let all = ''; for (let i = 0; i < l.length; i++) { const seen = o.x; kept = l[i]; all += seen + typeof kept + kept + ','; } return all; }
for (let t = 0; t < n; t++) { said.length = 0; const a = fresh(); let turns = 0; said.push(f(fresh(), { x: 1 }), f(a, { get x() { if (++turns === 3) a[4] = { toString() { return 'obj'; } }; return turns; } })); } console.log(said.join('/'));
