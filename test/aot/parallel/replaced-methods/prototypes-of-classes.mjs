// `prototype` of a class is the object that the class was made with, whatever is stored or defined on it.
class A { m() { return "A"; } static s = A.prototype; }
class B extends A { m() { return "B" + super.m(); } }
class N extends null { static own = N.prototype; }
const make = n => class { m() { return n; } };
const lines = [];
let total = 0;
for (let i = 0; i < 3000; i++) {
  const held = A.prototype, below = B.prototype;
  total += (held === A.s) + (below !== held) + (Object.getPrototypeOf(below) === held) + (N.prototype === N.own);
  held.extra = i;
  A.prototype.m = i & 1 ? function () { return "one"; } : function () { return "two!"; };
  total += new A().m().length + new B().m().length + new B().extra;
  const C = make(i);
  total += C.prototype.m.call(null) + (C.prototype !== make(i).prototype) + (new C() instanceof C);
  if (i % 1000 === 7) { try { A.prototype = { }; lines.push("stored"); } catch (error) { lines.push(error.name); } }
  if (i % 1000 === 8) { try { Object.defineProperty(A, "prototype", { value: { } }); lines.push("defined"); } catch (error) { lines.push(error.name); } }
  if (i % 1000 === 9) lines.push(delete Reflect.ownKeys(A)[0], Reflect.deleteProperty(A, "prototype"), Object.getOwnPropertyDescriptor(A, "prototype").writable, A.prototype.constructor === A);
}
console.log(total, lines.join(), Object.keys(A.prototype).join());
