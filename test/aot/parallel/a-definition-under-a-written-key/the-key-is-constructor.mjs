class A { a = 1; }
const o = new A;
function act() { Object.defineProperty(o, "constructor", { get() { this.a = "text"; return Object; } }); }
act();
console.log(typeof o.a, o.constructor === A, typeof o.a);
