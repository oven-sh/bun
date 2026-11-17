"use strict";
const D = JSON.parse("[1,2,3]"), K = JSON.parse("[\"twice\",\"constructor\",\"prototype\"]");
const out = [];
function tried(run) { try { return run(); } catch (error) { return error.name; } }
let asked = 0;
class Q { static twice(x) { return x * 2; } }
const qs = D.map(() => new Q());
function sum(n) { let s = 0; for (let i = 0; i < n; i++) s += Q.twice(i); return s; }
out.push(sum(40)); Object.defineProperty(qs[0][K[1]], K[0], { get() { asked++; return x => x * 7; } }); out.push(sum(40), asked);
console.log(out.join(" "));
