class A { a = 1; b = 2; }
class B { a = 1; b = 2; c = 3; }
const both = [new B, new A];
const o = both[both.length - 1];
function act() {
Reflect.defineProperty(o, "a", { get() { this.b = "text"; return "text"; } });
}
console.log(typeof o.a, typeof o.b);
act();
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
