// The subclass is new.target of its base constructor and is never constructed itself: it has no instances of its own making, and the fields of the base class are there all the same.
class A {
  x = 1;
  y = 2;
  #p = 3;
  constructor(q) {
    this.q = q;
  }
  p() {
    return this.#p;
  }
}
class B extends A {
  y = 20;
  z;
  x = 10;
  m() {
    return "B.m";
  }
}
const o = Reflect.construct(A, ["q"], B);
console.log(o.x, o.y, o.z, o.q, o.p(), o.m(), Object.hasOwn(o, "z"), Object.keys(o).join(), o instanceof B, Object.getPrototypeOf(o) === B.prototype);
const a = new A("r");
console.log(a.x, a.y, a.q, a.p(), Object.keys(a).join(), a instanceof B);
let total = 0;
for (let i = 0; i < 20000; i++) {
  const made = i & 1 ? Reflect.construct(A, [i], B) : new A(i);
  total += made.x + made.y + made.q + made.p();
}
console.log(total);
