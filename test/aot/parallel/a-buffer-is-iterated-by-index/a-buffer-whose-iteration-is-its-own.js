function sum(b) { let s = 0; for (const x of b) s = (s + x) | 0; return s; }
class Twice extends Buffer { *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield this[i] * 2; } }
class Plain extends Buffer {}
const plain = Buffer.alloc(4, 5), own = Buffer.alloc(4, 5), twice = Buffer.alloc(4, 5), below = Buffer.alloc(4, 5), named = Buffer.alloc(4, 5);
let told = ""; for (let round = 0; round < 4; round++) told += sum(plain) + " ";
own[Symbol.iterator] = function* () { yield 100; };
Object.setPrototypeOf(twice, Twice.prototype); Object.setPrototypeOf(below, Plain.prototype); named.extra = 1;
console.log(told, sum(own), sum(twice), sum(below), sum(named), sum(plain));
