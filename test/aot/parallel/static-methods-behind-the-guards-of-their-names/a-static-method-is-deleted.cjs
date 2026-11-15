"use strict";
const D = JSON.parse("[1,2,3]"), K = JSON.parse("[\"twice\",\"constructor\",\"prototype\"]");
const out = [];
function tried(run) { try { return run(); } catch (error) { return error.name; } }
class P { static twice(x) { return x + 1000; } } class Q extends P { static twice(x) { return x * 2; } }
const qs = D.map(() => new Q());
function sum(n) { let s = 0; for (let i = 0; i < n; i++) s += Q.twice(i); return s; }
out.push(sum(40)); delete qs[0][K[1]][K[0]]; out.push(sum(40)); delete P.twice; out.push(tried(() => sum(40)));
console.log(out.join(" "));
