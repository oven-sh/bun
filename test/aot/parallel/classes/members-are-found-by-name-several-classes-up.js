{
  console.log("a field, a method, a getter and a setter declared at the top");
  class A {
    field = 1;
    text = "a";
    method() { return this.field + 1; }
    get twice() { return this.field * 2; }
    set twice(value) { this.field = value / 2; }
  }
  class B extends A { b = 10; }
  class C extends B { c = 100; }
  class D extends C {
    d = 1000;
    sum() { return this.field + this.b + this.c + this.d + this.method() + this.twice + this.text.length; }
  }
  const d = new D();
  console.log(d.sum(), d.field, d.method(), d.twice, d.text);
  d.twice = 8;
  console.log(d.sum(), d.field, new C().method(), new B().twice);
}
{
  console.log("the nearest class that declares the name wins");
  class A { kind = "a"; name() { return "A"; } get size() { return 1; } }
  class B extends A { name() { return "B" + super.name(); } }
  class C extends B { kind = 3; }
  class D extends C { get size() { return super.size + 1; } }
  class E extends D { name() { return "E" + super.name(); } }
  for (const made of [new A(), new B(), new C(), new D(), new E()]) console.log(made.kind, made.name(), made.size);
}
{
  console.log("a member whose type follows `this`");
  class A {
    self = this;
    again() { return this; }
    list() { return [this]; }
  }
  class B extends A { b = 1; }
  class C extends B { c = 2; both() { return this.again().c + this.self.b + this.list()[0].c; } }
  console.log(new C().both(), new C().again() instanceof C, new B().self.b, new B().list()[0].b);
}
{
  console.log("names that no class of the row declares");
  class A { a = 1; }
  class B extends A { b = 2; }
  class C extends B { c = 3; }
  const c = new C();
  console.log(c.missing, typeof c.toString, c.hasOwnProperty("a"), c.constructor === C, "missing" in c, String(c));
  c.missing = 4;
  console.log(c.missing, Object.keys(c).join());
}
{
  console.log("one name, a number in one branch and a text in the other");
  class Root { id = 0; }
  class Left extends Root { value = 1; }
  class Right extends Root { value = "one"; }
  class LeftLeaf extends Left { read() { return this.value + this.id; } }
  class RightLeaf extends Right { read() { return this.value + this.id; } }
  console.log(new LeftLeaf().read(), new RightLeaf().read());
}
{
  console.log("fields stored in constructors, statics and private names");
  class A { #hidden = 5; static count = 1; constructor() { this.stored = 7; } hidden() { return this.#hidden; } }
  class B extends A { static more = 2; }
  class C extends B { #hidden = 6; own() { return this.#hidden + this.hidden() + this.stored; } }
  console.log(new C().own(), C.count, C.more, B.count, Object.hasOwn(C, "count"));
}
{
  console.log("a row of forty classes, each with a field and a method of its own, read from the bottom");
  let text = "class C0 { f0 = 0; m0() { return 0; } all() { return 0; } }\n";
  for (let index = 1; index <= 40; index++)
    text += `class C${index} extends C${index - 1} { f${index} = ${index}; m${index}() { return this.f${index - 1} + this.m${index - 1}(); } all() { return super.all() + this.f${index}; } }\n`;
  console.log(new Function(text + "const last = new C40(); return [last.f0, last.f20, last.f40, last.m40(), last.all(), Object.keys(last).length].join();")());
  class R0 { f0 = 0; m0() { return 0; } all() { return 0; } }
  class R1 extends R0 { f1 = 1; m1() { return this.f0 + this.m0(); } all() { return super.all() + this.f1; } }
  class R2 extends R1 { f2 = 2; m2() { return this.f1 + this.m1(); } all() { return super.all() + this.f2; } }
  class R3 extends R2 { f3 = 3; m3() { return this.f2 + this.m2(); } all() { return super.all() + this.f3; } }
  class R4 extends R3 { f4 = 4; m4() { return this.f3 + this.m3(); } all() { return super.all() + this.f4; } }
  class R5 extends R4 { f5 = 5; m5() { return this.f4 + this.m4(); } all() { return super.all() + this.f5; } }
  const last = new R5();
  console.log(last.f0, last.f3, last.f5, last.m5(), last.all(), Object.keys(last).join());
}
