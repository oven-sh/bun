const turns = +process.argv[2] || 200;
const side = process.argv[3] || "prototype";
function Other(x) { this.x = x * 2; this.other = true; }
function P(x) { this.x = x; }
P.prototype.next = function () { return new this.constructor(this.x + 1); };
const old = new P(1);
let others = 0, ps = 0, sum = 0, olds = 0;
for (let i = 0; i < turns; i++) { if (i === turns >> 1) P[side] = { next: P.prototype.next, constructor: Other }; const made = new P(i).next(); if (made.other) others++; if (made instanceof P) ps++; sum += made.x; const fromOld = old.next(); if (!fromOld.other && fromOld.x === 2) olds++; }
console.log(others, ps, sum, olds);
