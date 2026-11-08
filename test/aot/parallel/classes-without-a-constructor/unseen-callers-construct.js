class A { constructor(a, b) { this.a = a; this.b = b; } j() { return this.a; } }
class B extends A { k() { return (this.b === undefined ? 1 : this.b) + this.a; } }
class C extends B { }
globalThis.kept = [A, B, C];
const unseen = (0, eval)("(function (n) { let t = 0; for (let i = 0; i < n; i++) { const K = kept[1 + i % 2]; const o = i % 3 === 0 ? new K(i) : i % 3 === 1 ? new K(i, 2) : new K(i, 2, 3); t += o.j() + o.k(); } return t; })");
console.log(unseen(60000));
console.log(Reflect.construct(B, { length: 2, 0: 4, 1: 5 }).k(), Reflect.construct(C, [1]).k(), Reflect.construct(C, []).a);
