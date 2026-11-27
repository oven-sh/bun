// Each turn evaluates the class anew.
function kind(n) { return class { k = n; again() { return new this.constructor(); } }; }
let sum = 0;
for (let i = 0; i < 300; i++) { const K = kind(i), first = new K(), second = first.again(); sum += second.k + (second instanceof K ? 1000 : 0) + (second.constructor === K ? 100000 : 0); }
console.log(sum);
