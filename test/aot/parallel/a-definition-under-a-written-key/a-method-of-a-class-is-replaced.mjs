class A { a = 1; m() { return "method"; } }
function act() { Object.defineProperty(A.prototype, "m", { value() { this.a = "text"; return "other"; } }); }
const o = new A;
console.log(o.m());
act();
console.log(o.m(), typeof o.a);
