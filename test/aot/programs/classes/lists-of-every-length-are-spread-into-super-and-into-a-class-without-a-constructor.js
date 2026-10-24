// `super(...list)`, `new Below(...list)` and Reflect.construct(Below, list) with lists of 2 to 2,000,000 elements: whether the construction goes through or the list is too long to pass is what it is in plain Bun.
class A { constructor(a, b) { this.a = a; this.b = b; } }
class B extends A { constructor(xs) { super(...xs); this.n = xs.length; } }
class C extends A { x = 1; }
const kept = [];
for (const size of [2, 1000, 65535, 65536, 70000, 200000, 2000000]) {
  const xs = new Array(size).fill(7);
  for (const make of [() => new B(xs), () => new C(...xs), () => Reflect.construct(C, xs)]) {
    try {
      const made = make();
      kept.push(made);
      console.log(size, made.a, made.b, made.constructor.name);
    } catch (error) {
      console.log(size, error.name);
    }
  }
}
