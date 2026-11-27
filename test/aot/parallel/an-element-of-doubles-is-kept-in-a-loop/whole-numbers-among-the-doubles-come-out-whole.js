// Under: --aot-harden=proof-checks: what the arm reads is asked of the cell again
'use strict';
const fresh = () => JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5]"); const whole = () => JSON.parse("[1,2,3,4,5,6,7,8]"); const n = +process.argv[2] || 3; let kept; const said = [];
function f(l, out) { for (let i = 0; i < l.length; i++) { kept = l[i]; out.push(kept); } return out; }
for (let t = 0; t < n; t++) { said.length = 0; const got = f(JSON.parse('[0.5,2,-0,3,1e21,-7,2147483648,4.25]'), []); for (const g of got) said.push(Object.is(g, -0) ? '-0' : String(g), Number.isInteger(g), (g | 0)); } console.log(said.join());
