class A { kind() { return "above"; } }
Object.freeze(A.prototype);
function fill(a) { a.kind = 1; return a; }
console.log(typeof fill(new A()).kind);
