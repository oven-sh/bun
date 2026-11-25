const turns = +process.argv[2] || 200;
const step = turns > 0 ? 1 : 2;
let made = 0;
function twice(x) { return x * 2; }
function P(x) { this.x = x; this.y = twice(x) + step; made++; }
P.prototype.next = function () { return new this.constructor(this.x + step); };
let p = new P(0), sum = 0;
for (let i = 0; i < turns; i++) { p = p.next(); sum += p.x + p.y; }
console.log(sum, made, p instanceof P, p.constructor === P);
