// Under: --aot-harden=proof-checks: what the arm reads is asked of the cell again
'use strict';
const fresh = () => JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5]"); const whole = () => JSON.parse("[1,2,3,4,5,6,7,8]"); const n = +process.argv[2] || 3; let kept; const said = [];
const deeds = [(l, i) => 0, (l, i) => { if (i === 2) l[5] = 'text'; return 1; }, (l, i) => { if (i === 2) l[5] = 0.125; return 2; }];
function f(l, deed) { let all = ''; for (let i = 0; i < l.length; i++) { deed(l, i); kept = l[i]; all += typeof kept + kept + ','; } return all; }
for (let t = 0; t < n; t++) { said.length = 0; for (const deed of deeds) said.push(f(fresh(), deed), f(whole(), deed)); } console.log(said.join('/'));
