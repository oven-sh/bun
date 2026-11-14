const turns = +process.argv[2] || 200;
function P(x) { this.x = x; }
P.prototype = { next() { return new this.constructor(this.x + 1); } };
let numbers = 0, ps = 0, sum = 0;
for (let i = 0; i < turns; i++) { const made = new P(i).next(); if (made instanceof Number) numbers++; if (made instanceof P) ps++; sum += +made; }
console.log(numbers, ps, sum, new P(1).constructor === Object);
