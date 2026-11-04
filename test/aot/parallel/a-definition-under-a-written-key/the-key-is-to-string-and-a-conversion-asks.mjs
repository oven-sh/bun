class A { a = 1; }
const o = new A;
function act() { Object.defineProperty(o, "toString", { get() { this.a = "text"; return () => "converted"; } }); }
act();
console.log(typeof o.a, `${o}`, typeof o.a);
