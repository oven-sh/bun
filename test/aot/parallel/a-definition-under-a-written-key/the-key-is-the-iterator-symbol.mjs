class A { a = 1; }
const o = new A;
function act() { Object.defineProperty(o, Symbol.iterator, { get() { this.a = "text"; return function* () { yield 1; }; } }); }
act();
console.log(typeof o.a, [...o].join(), typeof o.a);
