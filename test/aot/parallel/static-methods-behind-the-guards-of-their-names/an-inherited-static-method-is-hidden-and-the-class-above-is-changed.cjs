"use strict";
const D = JSON.parse("[1,2,3]"), K = JSON.parse("[\"twice\",\"constructor\",\"prototype\"]");
const out = [];
function tried(run) { try { return run(); } catch (error) { return error.name; } }
class P { static twice(x) { return x * 2; } } class Q extends P {} class Other { static twice(x) { return x * 9; } }
const qs = D.map(() => new Q());
function sum(n) { let s = 0; for (let i = 0; i < n; i++) s += Q.twice(i); return s; }
out.push(sum(40)); Object.setPrototypeOf(qs[0][K[1]], Other); out.push(sum(40)); Q.twice = x => x; out.push(sum(40)); delete Q.twice; Object.setPrototypeOf(Q, P); P.twice = x => x * 4; out.push(sum(40));
console.log(out.join(" "));
