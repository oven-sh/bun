const turns = +process.argv[2] || 200;
const name = process.argv[3] || "constructor";
function P(x) { this.x = x; }
P.prototype.next = function () { return new this.constructor(this.x + 1); };
let numbers = 0, ps = 0, sum = 0;
for (let i = 0; i < turns; i++) { if (i === turns >> 1) delete P.prototype[name]; const made = new P(i).next(); if (made instanceof Number) numbers++; if (made instanceof P) ps++; sum += made instanceof P ? made.x : +made; }
console.log(numbers, ps, sum);
