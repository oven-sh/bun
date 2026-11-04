class A { a = 1; }
const o = new A;
function act() { Object.defineProperty(o, "toJSON", { get() { this.a = "text"; return undefined; } }); }
act();
console.log(typeof o.a, JSON.stringify(o), typeof o.a);
