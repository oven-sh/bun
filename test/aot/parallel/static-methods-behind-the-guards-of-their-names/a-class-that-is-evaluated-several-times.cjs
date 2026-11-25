"use strict";
const D = JSON.parse("[1,2,3]"), K = JSON.parse("[\"twice\",\"constructor\",\"prototype\"]");
const out = [];
function tried(run) { try { return run(); } catch (error) { return error.name; } }
function make(k) { return class Q { static twice(x) { return x * k; } }; }
const A = make(2), B = make(3);
const qs = D.map(() => new A());
function sum(C, n) { let s = 0; for (let i = 0; i < n; i++) s += C.twice(i); return s; }
out.push(sum(A, 40), sum(B, 40), sum(A, 40));
console.log(out.join(" "));
