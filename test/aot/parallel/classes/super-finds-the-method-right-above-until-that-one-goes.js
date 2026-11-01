{
  console.log("a row of methods");
  class A { m() { return "A"; } }
  class B extends A { m() { return "B<" + super.m(); } }
  class C extends B { m() { return "C<" + super.m(); } }
  class D extends C { m() { return "D<" + super.m(); } }
  console.log(new D().m(), new C().m(), new B().m());
}
{
  console.log("deleted by name");
  class A { m() { return "A"; } }
  class B extends A { m() { return "B"; } }
  class C extends B { m() { return "C<" + super.m(); } }
  const c = new C();
  console.log(c.m());
  delete B.prototype.m;
  console.log(c.m(), B.prototype.m === A.prototype.m, Object.hasOwn(B.prototype, "m"));
}
{
  console.log("deleted by a key that is put together");
  class A { m() { return "A"; } n() { return "An"; } }
  class B extends A { m() { return "B"; } n() { return "Bn"; } }
  class C extends B { m() { return "C<" + super.m(); } n() { return "C<" + super.n(); } }
  const c = new C();
  const keys = ["x", "m"];
  console.log(c.m(), c.n());
  for (const key of keys) delete B.prototype[key];
  console.log(c.m(), c.n());
}
{
  console.log("deleted through Reflect");
  class A { m() { return "A"; } }
  class B extends A { m() { return "B"; } }
  class C extends B { m() { return "C<" + super.m(); } }
  console.log(new C().m(), Reflect.deleteProperty(B.prototype, "m"), new C().m());
}
{
  console.log("deleted by somebody who was handed the prototype object");
  class A { m() { return "A"; } }
  class B extends A { m() { return "B"; } }
  class C extends B { m() { return "C<" + super.m(); } }
  const strip = (object, name) => { delete object[name]; };
  console.log(new C().m());
  [B.prototype].forEach(object => strip(object, "m"));
  console.log(new C().m());
}
{
  console.log("stored over");
  class A { m() { return "A"; } }
  class B extends A { m() { return "B"; } }
  class C extends B { m() { return "C<" + super.m(); } }
  console.log(new C().m());
  B.prototype.m = function () { return "B2"; };
  console.log(new C().m());
  A.prototype.m = function () { return "A2"; };
  console.log(new C().m(), new A().m());
}
{
  console.log("made a getter");
  class A { m() { return "A"; } }
  class B extends A { m() { return "B"; } }
  class C extends B { m() { return "C<" + super.m(); } }
  console.log(new C().m());
  Object.defineProperty(B.prototype, "m", { get() { return () => "from a getter of " + this.constructor.name; }, configurable: true });
  console.log(new C().m());
}
{
  console.log("another object above the home");
  class A { m() { return "A"; } }
  class B extends A { m() { return "B"; } }
  class C extends B { m() { return "C<" + super.m(); } }
  console.log(new C().m());
  Object.setPrototypeOf(C.prototype, A.prototype);
  console.log(new C().m());
  Object.setPrototypeOf(C.prototype, { m() { return "a literal"; } });
  console.log(new C().m());
  Object.setPrototypeOf(C.prototype, null);
  try { console.log(C.prototype.m.call({})); } catch (error) { console.log(error instanceof TypeError); }
}
{
  console.log("the class right above has no such method");
  class A { m() { return "A"; } }
  class B extends A { n() { return "Bn"; } }
  class C extends B { m() { return "C<" + super.m(); } n() { return "C<" + super.n(); } o() { return typeof super.o; } }
  console.log(new C().m(), new C().n(), new C().o());
}
{
  console.log("read off the prototype object");
  class A { m() { return "A"; } }
  class B extends A { m() { return "B"; } }
  console.log(B.prototype.m(), Object.getPrototypeOf(new B()).m.call(null));
  delete B.prototype.m;
  console.log(B.prototype.m(), Object.getPrototypeOf(new B()).m.call(null));
}
{
  console.log("one class text, evaluated for two parents");
  const below = Above => class extends Above { m() { return "below<" + super.m(); } };
  class A { m() { return "A"; } }
  class B { m() { return "B"; } }
  const [OverA, OverB] = [below(A), below(B)];
  const Twice = below(OverA);
  console.log(new OverA().m(), new OverB().m(), new Twice().m());
  delete OverA.prototype.m;
  console.log(new OverA().m(), new OverB().m(), new Twice().m());
}
{
  console.log("a computed name beside a written one");
  const name = ["m", "n"][Date.now() > 0 ? 0 : 1];
  class A { m() { return "A"; } n() { return "An"; } }
  class B extends A { [name]() { return "B by a computed name"; } }
  class C extends B { m() { return "C<" + super.m(); } n() { return "C<" + super.n(); } }
  console.log(new C().m(), new C().n());
}
{
  console.log("static methods, getters and setters");
  class A { static m() { return "A"; } get g() { return "Ag"; } set s(value) { this.seen = "As" + value; } }
  class B extends A { static m() { return "B<" + super.m(); } get g() { return "B<" + super.g; } set s(value) { super.s = value + "!"; } }
  class C extends B { static m() { return "C<" + super.m(); } get g() { return "C<" + super.g; } set s(value) { super.s = value + "?"; } }
  const c = new C();
  c.s = 1;
  console.log(C.m(), c.g, c.seen);
  delete B.m;
  delete B.prototype.g;
  console.log(C.m(), c.g);
}
{
  console.log("a method in an object literal");
  const above = { m() { return "above"; } };
  const middle = { __proto__: above, m() { return "middle<" + super.m(); } };
  const below = { __proto__: middle, m() { return "below<" + super.m(); } };
  console.log(below.m());
  delete middle.m;
  console.log(below.m());
}
