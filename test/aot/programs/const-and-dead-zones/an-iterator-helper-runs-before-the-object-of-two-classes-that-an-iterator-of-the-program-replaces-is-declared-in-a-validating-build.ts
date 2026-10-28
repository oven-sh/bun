// In a validating build: Iterator.prototype.some walks an array's iterator before an object of one of two classes is declared. An iterator of the program, made below the declaration, has the same members and replaces it in next().
console.log([1].values().some(Boolean));
class A { a = 1; get(): number { return this.a; } } class B { b = 2; get(): number { return this.b; } }
let either: A | B = new A(); let total = 0;
function make(): any { let i = 0; return { [Symbol.iterator](): any { return this; }, next(): any { total += either.get(); either = total > 1 ? new B() : new A(); const j = i++; return { done: j >= 2, value: j }; }, return(): any { return {}; } }; }
for (const value of make()) { }
console.log(total, either instanceof B);
