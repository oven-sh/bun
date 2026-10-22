// Prototype links that appear or change after lookups went through them.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { console.log(parts.map(String).join(" | ")); }

// 1: Object.setPrototypeOf on the receiver, the middle and the top
{
  function read(o) { return o.m; }
  const a = {}; show("1a", read(a));
  Object.setPrototypeOf(chain(a), { m: "receiver" }); show("1b", read(a).length);
  const top = {}, middle = Object.create(top), bottom = Object.create(middle);
  show("1c", read(bottom));
  Object.setPrototypeOf(chain(top), { m: () => "top" }); show("1d", read(bottom)());
  Object.setPrototypeOf(chain(middle), { m: 5 }); show("1e", read(bottom) + 1);
}
// 2: Object.create with a prototype that arrives late
{
  function make(p) { return Object.create(p); }
  function read(o) { return o.m; }
  show("2a", read(make({ m: 1 })) + 1);
  show("2b", read(make(chain({ m: "text" }))).length);
  show("2c", read(make(chain(null))));
}
// 3: the prototype property of a function is replaced late
{
  function F() { this.own = 1; }
  F.prototype.m = function () { return "first"; };
  function call(o) { return o.m(); }
  show("3a", call(new F()));
  function replace(f) { f.prototype = { m() { return 2; } }; }
  replace(chain(F));
  show("3b", call(new F()) + 1);
}
// 4: a method added late to the prototype property
{
  function F() {}
  const o = new F();
  function read(x) { return x.late; }
  show("4a", read(o));
  chain(F).prototype.late = function () { return this === o; };
  show("4b", read(o).call(o), o.late());
}
// 5: classes from a function: the base arrives late
{
  const mixin = (Base) => class extends Base { mixed() { return super.base(); } };
  class A { base() { return 1; } }
  class B { base() { return "text"; } }
  const MA = mixin(A);
  show("5a", new MA().mixed() + 1);
  const MB = mixin(chain(B));
  show("5b", new MB().mixed().length);
}
// 6: Reflect.setPrototypeOf, __proto__ in a literal with a late value, Object.setPrototypeOf to null
{
  function read(o) { return o.m; }
  const a = {}; Reflect.setPrototypeOf(chain(a), { m: "reflect" }); show("6a", read(a).length);
  const late = chain({ m: [1] }); const b = { __proto__: late }; show("6b", read(b).length);
  const c = { __proto__: chain(5), n: 1 }; show("6c", read(c), typeof c.toString);
  const d = { m2: 1 }; Object.setPrototypeOf(chain(d), null); show("6d", d.toString, d.m2 + 1);
}
// 7: the prototype of a class prototype changes
{
  class Base { who() { return "base"; } }
  class Other { who() { return 7; } }
  class Leaf extends Base {}
  function ask(o) { return o.who(); }
  show("7a", ask(new Leaf()).length);
  Object.setPrototypeOf(chain(Leaf.prototype), chain(Other.prototype));
  show("7b", ask(new Leaf()) + 1);
}
// 8: Reflect.construct with another new target
{
  class A { constructor() { this.a = 1; } who() { return "A"; } }
  class B { who() { return 2; } }
  function ask(o) { return o.who(); }
  show("8a", ask(new A()).length);
  show("8b", ask(Reflect.construct(A, [], chain(B))) + 1);
}
// 9: a cycle of candidates: one flow object as its own prototype
{
  function wrap(p) { return Object.create(p); }
  let o = { depth: "root" };
  for (let i = 0; i < 4; i++) o = wrap(o);
  show("9", o.depth.length, Object.getPrototypeOf(Object.getPrototypeOf(o)).depth.length);
}
// 10: getPrototypeOf after a late change, on objects and on a built-in
{
  function proto(o) { return Object.getPrototypeOf(o); }
  const a = {}; show("10a", proto(a) === Object.prototype);
  const p = { marker: "p" }; Object.setPrototypeOf(chain(a), p); show("10b", proto(a).marker.length);
  class MyError extends Error {}
  show("10c", proto(MyError) === Error, proto(MyError.prototype) === Error.prototype);
}
// 11: instanceof and isPrototypeOf after a late change
{
  class A {} class B {}
  const o = new A();
  function test(x) { return [x instanceof A, x instanceof B, B.prototype.isPrototypeOf(x)].join(); }
  show("11a", test(o));
  Object.setPrototypeOf(chain(o), B.prototype);
  show("11b", test(o));
}
