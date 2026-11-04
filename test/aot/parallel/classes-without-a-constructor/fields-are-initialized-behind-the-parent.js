let order = "";
class A { constructor(x) { this.x = x; if (order.length < 40) order += "A" + ("f" in this); } }
class B extends A { f = this.x + 1; g = (order.length < 40 ? (order += "g") : 0, 2); #h = this.f * 2; h() { return this.#h; } }
class C extends B { i = this.h() + this.g; }
globalThis.kept = [A, B, C];
function run(n) { let t = 0; for (let i = 0; i < n; i++) { const o = i % 2 ? new B(i) : new C(i); t += o.f + o.g + o.h() + (o.i || 0); } return t; }
console.log(run(30000), order, Object.keys(new C(1)).join());
