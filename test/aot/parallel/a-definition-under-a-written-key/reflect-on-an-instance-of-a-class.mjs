class A { a = 1; b = 2; }
const o = new A;
function act() {
Reflect.defineProperty(o, "a", { get() { this.b = "text"; return "text"; } });
}
console.log(typeof o.a, typeof o.b);
act();
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
