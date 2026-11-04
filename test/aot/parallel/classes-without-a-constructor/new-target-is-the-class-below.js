class A { constructor(x) { this.made = new.target.name; this.x = x; } }
class B extends A { k() { return this.x + 1; } }
class C extends B { k() { return this.x + 2; } }
globalThis.kept = [A, B, C];
function run(n) { let t = 0, names = ""; for (let i = 0; i < n; i++) { const o = i % 2 ? new B(i) : new C(i); t += o.k(); if (i < 4) names += o.made + (o instanceof C) + (Object.getPrototypeOf(o) === (i % 2 ? B : C).prototype) + " "; } return names + t; }
console.log(run(30000));
console.log(Reflect.construct(B, [5], C).made, Reflect.construct(B, [5], C) instanceof C, Reflect.construct(C, [6], A).k === undefined);
