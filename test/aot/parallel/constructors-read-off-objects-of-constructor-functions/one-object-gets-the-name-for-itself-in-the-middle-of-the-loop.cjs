const turns = +process.argv[2] || 200;
const name = process.argv[3] || "constructor";
function Other(x) { this.x = x * 2; this.other = true; }
function P(x) { this.x = x; }
P.prototype.next = function () { return new this.constructor(this.x + 1); };
const first = new P(1), second = new P(2);
let others = 0, ps = 0, sum = 0;
for (let i = 0; i < turns; i++) { if (i === turns >> 1) first[name] = Other; const made = (i & 1 ? first : second).next(); if (made.other) others++; if (made instanceof P) ps++; sum += made.x; }
console.log(others, ps, sum);
