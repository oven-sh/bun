const turns = +process.argv[2] || 200;
function P(x) { this.x = x; }
P.prototype.next = function () { return new this.constructor(this.x + 1); };
let p = new P(0), sum = 0;
for (let i = 0; i < turns; i++) { p = p.next(); sum += p.x; }
console.log(sum, p instanceof P, p.constructor === P, Object.getPrototypeOf(p) === P.prototype);
