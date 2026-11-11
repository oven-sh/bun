"use strict";
const D = JSON.parse("[1,2,3]"), K = JSON.parse("[\"twice\",\"constructor\",\"prototype\"]");
const out = [];
function tried(run) { try { return run(); } catch (error) { return error.name; } }
class Q { static count = 0; static make() { this.count++; return new this(); } static who() { return this === Q ? 1 : 2; } } class R extends Q {}
const qs = D.map(() => new Q());
function sum(n) { let s = 0; for (let i = 0; i < n; i++) { s += Q.who() + R.who() * 10 + (Q.make() instanceof Q ? 1 : 0) + (R.make() instanceof R ? 100 : 0); } return s; }
out.push(sum(40), Q.count, R.count, Object.prototype.hasOwnProperty.call(R, "count"));
console.log(out.join(" "));
