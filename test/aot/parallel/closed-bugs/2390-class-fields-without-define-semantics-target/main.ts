// @ts-nocheck (the checker refuses new.target here: TS17013)
class A { x = new.target; y = (() => new.target)(); }
class B extends A { z = new.target; }
const b = new B();
console.log(typeof b.x, b.x && b.x.name, typeof b.y, b.y && b.y.name, typeof b.z, b.z && b.z.name);
// bun run (base8), and what tsc emits: function B function B function B . the executable: undefined undefined undefined undefined undefined undefined
