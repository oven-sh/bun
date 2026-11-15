const turns = +process.argv[2] || 200;
const name = process.argv[3] || "constructor";
function P(x) { this.x = x; }
P.prototype.next = function () { return new this.constructor(this.x + 1); };
function Q(x) { P.call(this, x); this.q = true; }
Q.prototype = Object.create(P.prototype);
Q.prototype[name] = Q;
let p = new P(0), q = new Q(0), qs = 0, sum = 0;
for (let i = 0; i < turns; i++) { p = p.next(); q = q.next(); if (q.q && q instanceof Q) qs++; if (p.q) qs = -1; sum += p.x + q.x; }
console.log(qs, sum, p.constructor === P, q.constructor === Q);
