class A { a = 1; }
function act() { Object.defineProperty(A.prototype, "x", { get() { this.a = "text"; return 7; } }); }
const o = new A;
act();
console.log(typeof o.a, o.x, typeof o.a);
