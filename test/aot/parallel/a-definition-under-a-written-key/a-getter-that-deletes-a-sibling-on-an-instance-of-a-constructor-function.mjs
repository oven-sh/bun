function A() { this.a = 1; this.b = 2; }
const o = new A;
function act() {
Object.defineProperty(o, "a", { get() { delete this.b; return 1; } });
}
console.log(typeof o.a, typeof o.b);
act();
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
console.log(typeof o.a, typeof o.b, Object.keys(o).join());
