const turns = +process.argv[2] || 200;
function make(tag) { function P(x) { this.x = x; this.tag = tag; } P.prototype.next = function () { return new this.constructor(this.x + 1); }; return P; }
const A = make("a"), B = make("b");
let a = new A(0), b = new B(0), right = 0;
for (let i = 0; i < turns; i++) { a = a.next(); b = b.next(); if (a.tag === "a" && b.tag === "b" && a instanceof A && b instanceof B && !(a instanceof B)) right++; }
console.log(right, a.x + b.x, a.constructor === A, b.constructor === B);
