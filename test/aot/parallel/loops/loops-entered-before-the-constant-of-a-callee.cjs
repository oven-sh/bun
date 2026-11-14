// A loop whose only callee counts in a constant's object is entered, for no iteration, before the constant is stored: by a variable that holds the callee later, by a parameter, and by a callee that is declared.
'use strict';
const out = [];
let later;
function inc(x) { state.count++; state.total += x; }
function run(turns) { for (let k = 0; k < turns; k++) later(k & 3); return turns; }
function each(f, turns) { for (let k = 0; k < turns; k++) f(k & 3); return turns; }
function direct(turns) { for (let k = 0; k < turns; k++) add(k & 3); return turns; }
out.push(run(0), each(null, 0));
const state = { count: 0, total: 0 };
later = inc;
out.push(run(9), each(inc, 5), state.count, state.total);
out.push(direct(0));
function add(x) { sums.n += x; sums.m -= 1; }
const sums = { n: 0, m: 0 };
out.push(direct(7), sums.n, sums.m);
console.log(out.join());
