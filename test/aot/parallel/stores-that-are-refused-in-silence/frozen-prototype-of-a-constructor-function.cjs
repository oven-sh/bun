function A() {}
A.prototype.kind = "above";
Object.freeze(A.prototype);
const a = new A();
a.kind = "own";
console.log(a.kind, Object.keys(a).length);
