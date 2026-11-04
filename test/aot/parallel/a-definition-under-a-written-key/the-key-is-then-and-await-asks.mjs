class A { a = 1; }
const o = new A;
function act() { Object.defineProperty(o, "then", { get() { this.a = "text"; return undefined; } }); }
act();
console.log(typeof o.a);
await o;
console.log(typeof o.a);
