const turns = +process.argv[2] || 200;
const name = process.argv[3] || "constructor";
function Other(x) { this.x = x * 2; this.other = true; }
function P(x) { this.x = x; }
P.prototype.next = function () { return new this.constructor(this.x + 1); };
P.prototype[name] = Other;
let others = 0, ps = 0, sum = 0;
for (let i = 0; i < turns; i++) { const made = new P(i).next(); if (made.other) others++; if (made instanceof P) ps++; sum += made.x; }
console.log(others, ps, sum);
