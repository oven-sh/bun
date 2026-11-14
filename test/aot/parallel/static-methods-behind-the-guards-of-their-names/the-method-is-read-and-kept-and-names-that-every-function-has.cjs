"use strict";
const D = JSON.parse("[1,2,3]"), K = JSON.parse("[\"twice\",\"constructor\",\"prototype\"]");
const out = [];
function tried(run) { try { return run(); } catch (error) { return error.name; } }
class Q { static twice(x) { return x * 2; } static get half() { return x => x / 2; } static [K[2] + "x"](x) { return x; } }
const qs = D.map(() => new Q());
function sum(n) { let s = 0; for (let i = 0; i < n; i++) { const kept = Q.twice; s += kept(i) + Q.half(i) + Q.name.length + Q.length + (Q.twice === kept ? 1 : 0); } return s; }
out.push(sum(40), tried(() => Q.call(null)), tried(() => Q.apply(null, [])), typeof Q.bind(null), Q.toString().length > 10, tried(() => { for (let i = 0; i < 3; i++) Q.missing(i); }));
console.log(out.join(" "));
