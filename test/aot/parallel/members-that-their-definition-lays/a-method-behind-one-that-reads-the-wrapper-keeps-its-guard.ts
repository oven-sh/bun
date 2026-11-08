// As a bundler lays a module: a wrapper that runs once, classes in it, a method that reads what the wrapper holds. The record of the class cannot make that method, so the definition lays it and every member behind it.
// The run time has to take what the definition lays for what the record says: no guard of a name ends at the class's own definition.
// COUNT: counter:ClassGuardBitsEnded = 0
function init() {
  const table = { step: 3 };
  class A { a: number; constructor(a: number) { this.a = a; } m(): number { return this.a + table.step; } k(): number { return 1; } }
  class B extends A { k(): number { return 2; } }
  class C extends A { k(): number { return 3; } }
  function measure(x: A): number { return x.m() + x.k(); }
  return { A, B, C, measure };
}
const { A, B, C, measure } = init();
// Unseen code may change the classes, so what is known of their methods stands on guards.
(globalThis as any).kept = [A, B, C];
function run(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += measure(i % 3 == 0 ? new A(i) : i % 3 == 1 ? new B(i) : new C(i)); return t; }
console.log(run(6));
export {};
