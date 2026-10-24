// A method that is only called, in every form of call, on an object literal, a class instance, a prototype object and stored after creation.
const lines = [];
function printer(label) {
  return (...values) => {
    let text = label + ":";
    for (let i = 0; i < values.length; i++) text += " " + String(values[i]);
    lines.push(text);
  };
}

{
  const print = printer("call literal");
  const o = { m() { return 7 } };
  print(o.m());
}
{
  const print = printer("call literal-function");
  const o = { m: function () { return 7 } };
  print(o.m());
}
{
  const print = printer("call literal-with-field");
  const o = { x: 1, m() { return 7 } };
  print(o.m());
}
{
  const print = printer("call class-method");
  class C { m() { return 7 } }
  const o = new C();
  print(o.m());
}
{
  const print = printer("call class-field");
  class C { m = function () { return 7 }; }
  const o = new C();
  print(o.m());
}
{
  const print = printer("call subclass");
  class B { m() { return 7 } }
  class C extends B {}
  const o = new C();
  print(o.m());
}
{
  const print = printer("call class-static");
  class C { static m() { return 7 } }
  const o = C;
  print(o.m());
}
{
  const print = printer("call prototype-create");
  const p = { m() { return 7 } };
  const o = Object.create(p);
  print(o.m());
}
{
  const print = printer("call prototype-literal");
  const p = { m() { return 7 } };
  const o = { __proto__: p };
  print(o.m());
}
{
  const print = printer("call prototype-literal-with-field");
  const p = { m() { return 7 } };
  const o = { __proto__: p, x: 1 };
  print(o.m());
}
{
  const print = printer("call prototype-set");
  const p = { m() { return 7 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(o.m());
}
{
  const print = printer("call prototype-set-with-field");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(o.m());
}
{
  const print = printer("call prototype-reflect-set");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(o.m());
}
{
  const print = printer("call prototype-proto-store");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(o.m());
}
{
  const print = printer("call prototype-two-levels");
  const p = { m() { return 7 } };
  const o = Object.create(Object.create(p));
  print(o.m());
}
{
  const print = printer("call prototype-of-class-instance");
  const p = { m() { return 7 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(o.m());
}
{
  const print = printer("call prototype-is-instance");
  class C { m = function () { return 7 }; }
  const o = Object.create(new C());
  print(o.m());
}
{
  const print = printer("call stored-after");
  const o = {};
  o.m = function () { return 7 };
  print(o.m());
}
{
  const print = printer("call stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return 7 };
  print(o.m());
}
{
  const print = printer("call stored-after-on-prototype");
  const p = {};
  p.m = function () { return 7 };
  const o = Object.create(p);
  print(o.m());
}
{
  const print = printer("call stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return 7 };
  print(o.m());
}
{
  const print = printer("call stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return 7 };
  print(o.m());
}
{
  const print = printer("call stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return 7 };
  const o = new C();
  print(o.m());
}
{
  const print = printer("call constructor-function");
  function F() {}
  F.prototype.m = function () { return 7 };
  const o = new F();
  print(o.m());
}
{
  const print = printer("call constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return 7 } };
  const o = new F();
  print(o.m());
}
{
  const print = printer("call constructor-function-this");
  function F() { this.m = function () { return 7 }; }
  const o = new F();
  print(o.m());
}
{
  const print = printer("call getter");
  const o = { get m() { return function () { return 7 }; } };
  print(o.m());
}
{
  const print = printer("call defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return 7 } });
  print(o.m());
}
{
  const print = printer("call assigned");
  const o = Object.assign({}, { m() { return 7 } });
  print(o.m());
}
{
  const print = printer("call spread-copy");
  const o = { ...{ m() { return 7 } } };
  print(o.m());
}
{
  const print = printer("call made-in-function");
  function make() { return { m() { return 7 } }; }
  const o = make();
  print(o.m());
}
{
  const print = printer("call made-in-function-twice");
  function make() { return { m() { return 7 } }; }
  make();
  const o = make();
  print(o.m());
}
{
  const print = printer("call literal-arrow");
  const o = { m: () => { return 7 } };
  print(o.m());
}
{
  const print = printer("call class-field-arrow");
  class C { m = () => { return 7 }; }
  const o = new C();
  print(o.m());
}
{
  const print = printer("call prototype-create-arrow");
  const p = { m: () => { return 7 } };
  const o = Object.create(p);
  print(o.m());
}
{
  const print = printer("call-optional literal");
  const o = { m() { return 7 } };
  print(o.m?.());
}
{
  const print = printer("call-optional literal-function");
  const o = { m: function () { return 7 } };
  print(o.m?.());
}
{
  const print = printer("call-optional literal-with-field");
  const o = { x: 1, m() { return 7 } };
  print(o.m?.());
}
{
  const print = printer("call-optional class-method");
  class C { m() { return 7 } }
  const o = new C();
  print(o.m?.());
}
{
  const print = printer("call-optional class-field");
  class C { m = function () { return 7 }; }
  const o = new C();
  print(o.m?.());
}
{
  const print = printer("call-optional subclass");
  class B { m() { return 7 } }
  class C extends B {}
  const o = new C();
  print(o.m?.());
}
{
  const print = printer("call-optional class-static");
  class C { static m() { return 7 } }
  const o = C;
  print(o.m?.());
}
{
  const print = printer("call-optional prototype-create");
  const p = { m() { return 7 } };
  const o = Object.create(p);
  print(o.m?.());
}
{
  const print = printer("call-optional prototype-literal");
  const p = { m() { return 7 } };
  const o = { __proto__: p };
  print(o.m?.());
}
{
  const print = printer("call-optional prototype-literal-with-field");
  const p = { m() { return 7 } };
  const o = { __proto__: p, x: 1 };
  print(o.m?.());
}
{
  const print = printer("call-optional prototype-set");
  const p = { m() { return 7 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(o.m?.());
}
{
  const print = printer("call-optional prototype-set-with-field");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(o.m?.());
}
{
  const print = printer("call-optional prototype-reflect-set");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(o.m?.());
}
{
  const print = printer("call-optional prototype-proto-store");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(o.m?.());
}
{
  const print = printer("call-optional prototype-two-levels");
  const p = { m() { return 7 } };
  const o = Object.create(Object.create(p));
  print(o.m?.());
}
{
  const print = printer("call-optional prototype-of-class-instance");
  const p = { m() { return 7 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(o.m?.());
}
{
  const print = printer("call-optional prototype-is-instance");
  class C { m = function () { return 7 }; }
  const o = Object.create(new C());
  print(o.m?.());
}
{
  const print = printer("call-optional stored-after");
  const o = {};
  o.m = function () { return 7 };
  print(o.m?.());
}
{
  const print = printer("call-optional stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return 7 };
  print(o.m?.());
}
{
  const print = printer("call-optional stored-after-on-prototype");
  const p = {};
  p.m = function () { return 7 };
  const o = Object.create(p);
  print(o.m?.());
}
{
  const print = printer("call-optional stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return 7 };
  print(o.m?.());
}
{
  const print = printer("call-optional stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return 7 };
  print(o.m?.());
}
{
  const print = printer("call-optional stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return 7 };
  const o = new C();
  print(o.m?.());
}
{
  const print = printer("call-optional constructor-function");
  function F() {}
  F.prototype.m = function () { return 7 };
  const o = new F();
  print(o.m?.());
}
{
  const print = printer("call-optional constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return 7 } };
  const o = new F();
  print(o.m?.());
}
{
  const print = printer("call-optional constructor-function-this");
  function F() { this.m = function () { return 7 }; }
  const o = new F();
  print(o.m?.());
}
{
  const print = printer("call-optional getter");
  const o = { get m() { return function () { return 7 }; } };
  print(o.m?.());
}
{
  const print = printer("call-optional defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return 7 } });
  print(o.m?.());
}
{
  const print = printer("call-optional assigned");
  const o = Object.assign({}, { m() { return 7 } });
  print(o.m?.());
}
{
  const print = printer("call-optional spread-copy");
  const o = { ...{ m() { return 7 } } };
  print(o.m?.());
}
{
  const print = printer("call-optional made-in-function");
  function make() { return { m() { return 7 } }; }
  const o = make();
  print(o.m?.());
}
{
  const print = printer("call-optional made-in-function-twice");
  function make() { return { m() { return 7 } }; }
  make();
  const o = make();
  print(o.m?.());
}
{
  const print = printer("call-optional literal-arrow");
  const o = { m: () => { return 7 } };
  print(o.m?.());
}
{
  const print = printer("call-optional class-field-arrow");
  class C { m = () => { return 7 }; }
  const o = new C();
  print(o.m?.());
}
{
  const print = printer("call-optional prototype-create-arrow");
  const p = { m: () => { return 7 } };
  const o = Object.create(p);
  print(o.m?.());
}
{
  const print = printer("call-bracket literal");
  const o = { m() { return 7 } };
  print(o["m"]());
}
{
  const print = printer("call-bracket literal-function");
  const o = { m: function () { return 7 } };
  print(o["m"]());
}
{
  const print = printer("call-bracket literal-with-field");
  const o = { x: 1, m() { return 7 } };
  print(o["m"]());
}
{
  const print = printer("call-bracket class-method");
  class C { m() { return 7 } }
  const o = new C();
  print(o["m"]());
}
{
  const print = printer("call-bracket class-field");
  class C { m = function () { return 7 }; }
  const o = new C();
  print(o["m"]());
}
{
  const print = printer("call-bracket subclass");
  class B { m() { return 7 } }
  class C extends B {}
  const o = new C();
  print(o["m"]());
}
{
  const print = printer("call-bracket class-static");
  class C { static m() { return 7 } }
  const o = C;
  print(o["m"]());
}
{
  const print = printer("call-bracket prototype-create");
  const p = { m() { return 7 } };
  const o = Object.create(p);
  print(o["m"]());
}
{
  const print = printer("call-bracket prototype-literal");
  const p = { m() { return 7 } };
  const o = { __proto__: p };
  print(o["m"]());
}
{
  const print = printer("call-bracket prototype-literal-with-field");
  const p = { m() { return 7 } };
  const o = { __proto__: p, x: 1 };
  print(o["m"]());
}
{
  const print = printer("call-bracket prototype-set");
  const p = { m() { return 7 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(o["m"]());
}
{
  const print = printer("call-bracket prototype-set-with-field");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(o["m"]());
}
{
  const print = printer("call-bracket prototype-reflect-set");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(o["m"]());
}
{
  const print = printer("call-bracket prototype-proto-store");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(o["m"]());
}
{
  const print = printer("call-bracket prototype-two-levels");
  const p = { m() { return 7 } };
  const o = Object.create(Object.create(p));
  print(o["m"]());
}
{
  const print = printer("call-bracket prototype-of-class-instance");
  const p = { m() { return 7 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(o["m"]());
}
{
  const print = printer("call-bracket prototype-is-instance");
  class C { m = function () { return 7 }; }
  const o = Object.create(new C());
  print(o["m"]());
}
{
  const print = printer("call-bracket stored-after");
  const o = {};
  o.m = function () { return 7 };
  print(o["m"]());
}
{
  const print = printer("call-bracket stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return 7 };
  print(o["m"]());
}
{
  const print = printer("call-bracket stored-after-on-prototype");
  const p = {};
  p.m = function () { return 7 };
  const o = Object.create(p);
  print(o["m"]());
}
{
  const print = printer("call-bracket stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return 7 };
  print(o["m"]());
}
{
  const print = printer("call-bracket stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return 7 };
  print(o["m"]());
}
{
  const print = printer("call-bracket stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return 7 };
  const o = new C();
  print(o["m"]());
}
{
  const print = printer("call-bracket constructor-function");
  function F() {}
  F.prototype.m = function () { return 7 };
  const o = new F();
  print(o["m"]());
}
{
  const print = printer("call-bracket constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return 7 } };
  const o = new F();
  print(o["m"]());
}
{
  const print = printer("call-bracket constructor-function-this");
  function F() { this.m = function () { return 7 }; }
  const o = new F();
  print(o["m"]());
}
{
  const print = printer("call-bracket getter");
  const o = { get m() { return function () { return 7 }; } };
  print(o["m"]());
}
{
  const print = printer("call-bracket defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return 7 } });
  print(o["m"]());
}
{
  const print = printer("call-bracket assigned");
  const o = Object.assign({}, { m() { return 7 } });
  print(o["m"]());
}
{
  const print = printer("call-bracket spread-copy");
  const o = { ...{ m() { return 7 } } };
  print(o["m"]());
}
{
  const print = printer("call-bracket made-in-function");
  function make() { return { m() { return 7 } }; }
  const o = make();
  print(o["m"]());
}
{
  const print = printer("call-bracket made-in-function-twice");
  function make() { return { m() { return 7 } }; }
  make();
  const o = make();
  print(o["m"]());
}
{
  const print = printer("call-bracket literal-arrow");
  const o = { m: () => { return 7 } };
  print(o["m"]());
}
{
  const print = printer("call-bracket class-field-arrow");
  class C { m = () => { return 7 }; }
  const o = new C();
  print(o["m"]());
}
{
  const print = printer("call-bracket prototype-create-arrow");
  const p = { m: () => { return 7 } };
  const o = Object.create(p);
  print(o["m"]());
}
{
  const print = printer("call-apply literal");
  const o = { m() { return 7 } };
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply literal-function");
  const o = { m: function () { return 7 } };
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply literal-with-field");
  const o = { x: 1, m() { return 7 } };
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply class-method");
  class C { m() { return 7 } }
  const o = new C();
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply class-field");
  class C { m = function () { return 7 }; }
  const o = new C();
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply subclass");
  class B { m() { return 7 } }
  class C extends B {}
  const o = new C();
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply class-static");
  class C { static m() { return 7 } }
  const o = C;
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply prototype-create");
  const p = { m() { return 7 } };
  const o = Object.create(p);
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply prototype-literal");
  const p = { m() { return 7 } };
  const o = { __proto__: p };
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply prototype-literal-with-field");
  const p = { m() { return 7 } };
  const o = { __proto__: p, x: 1 };
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply prototype-set");
  const p = { m() { return 7 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply prototype-set-with-field");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply prototype-reflect-set");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply prototype-proto-store");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply prototype-two-levels");
  const p = { m() { return 7 } };
  const o = Object.create(Object.create(p));
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply prototype-of-class-instance");
  const p = { m() { return 7 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply prototype-is-instance");
  class C { m = function () { return 7 }; }
  const o = Object.create(new C());
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply stored-after");
  const o = {};
  o.m = function () { return 7 };
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return 7 };
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply stored-after-on-prototype");
  const p = {};
  p.m = function () { return 7 };
  const o = Object.create(p);
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return 7 };
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return 7 };
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return 7 };
  const o = new C();
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply constructor-function");
  function F() {}
  F.prototype.m = function () { return 7 };
  const o = new F();
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return 7 } };
  const o = new F();
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply constructor-function-this");
  function F() { this.m = function () { return 7 }; }
  const o = new F();
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply getter");
  const o = { get m() { return function () { return 7 }; } };
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return 7 } });
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply assigned");
  const o = Object.assign({}, { m() { return 7 } });
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply spread-copy");
  const o = { ...{ m() { return 7 } } };
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply made-in-function");
  function make() { return { m() { return 7 } }; }
  const o = make();
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply made-in-function-twice");
  function make() { return { m() { return 7 } }; }
  make();
  const o = make();
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply literal-arrow");
  const o = { m: () => { return 7 } };
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply class-field-arrow");
  class C { m = () => { return 7 }; }
  const o = new C();
  print(o.m.apply(o, []));
}
{
  const print = printer("call-apply prototype-create-arrow");
  const p = { m: () => { return 7 } };
  const o = Object.create(p);
  print(o.m.apply(o, []));
}
{
  const print = printer("call-bind literal");
  const o = { m() { return 7 } };
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind literal-function");
  const o = { m: function () { return 7 } };
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind literal-with-field");
  const o = { x: 1, m() { return 7 } };
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind class-method");
  class C { m() { return 7 } }
  const o = new C();
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind class-field");
  class C { m = function () { return 7 }; }
  const o = new C();
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind subclass");
  class B { m() { return 7 } }
  class C extends B {}
  const o = new C();
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind class-static");
  class C { static m() { return 7 } }
  const o = C;
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind prototype-create");
  const p = { m() { return 7 } };
  const o = Object.create(p);
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind prototype-literal");
  const p = { m() { return 7 } };
  const o = { __proto__: p };
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind prototype-literal-with-field");
  const p = { m() { return 7 } };
  const o = { __proto__: p, x: 1 };
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind prototype-set");
  const p = { m() { return 7 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind prototype-set-with-field");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind prototype-reflect-set");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind prototype-proto-store");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind prototype-two-levels");
  const p = { m() { return 7 } };
  const o = Object.create(Object.create(p));
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind prototype-of-class-instance");
  const p = { m() { return 7 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind prototype-is-instance");
  class C { m = function () { return 7 }; }
  const o = Object.create(new C());
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind stored-after");
  const o = {};
  o.m = function () { return 7 };
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return 7 };
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind stored-after-on-prototype");
  const p = {};
  p.m = function () { return 7 };
  const o = Object.create(p);
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return 7 };
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return 7 };
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return 7 };
  const o = new C();
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind constructor-function");
  function F() {}
  F.prototype.m = function () { return 7 };
  const o = new F();
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return 7 } };
  const o = new F();
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind constructor-function-this");
  function F() { this.m = function () { return 7 }; }
  const o = new F();
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind getter");
  const o = { get m() { return function () { return 7 }; } };
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return 7 } });
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind assigned");
  const o = Object.assign({}, { m() { return 7 } });
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind spread-copy");
  const o = { ...{ m() { return 7 } } };
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind made-in-function");
  function make() { return { m() { return 7 } }; }
  const o = make();
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind made-in-function-twice");
  function make() { return { m() { return 7 } }; }
  make();
  const o = make();
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind literal-arrow");
  const o = { m: () => { return 7 } };
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind class-field-arrow");
  class C { m = () => { return 7 }; }
  const o = new C();
  print(o.m.bind(o)());
}
{
  const print = printer("call-bind prototype-create-arrow");
  const p = { m: () => { return 7 } };
  const o = Object.create(p);
  print(o.m.bind(o)());
}
{
  const print = printer("call-pattern literal");
  const o = { m() { return 7 } };
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern literal-function");
  const o = { m: function () { return 7 } };
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern literal-with-field");
  const o = { x: 1, m() { return 7 } };
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern class-method");
  class C { m() { return 7 } }
  const o = new C();
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern class-field");
  class C { m = function () { return 7 }; }
  const o = new C();
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern subclass");
  class B { m() { return 7 } }
  class C extends B {}
  const o = new C();
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern class-static");
  class C { static m() { return 7 } }
  const o = C;
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern prototype-create");
  const p = { m() { return 7 } };
  const o = Object.create(p);
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern prototype-literal");
  const p = { m() { return 7 } };
  const o = { __proto__: p };
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern prototype-literal-with-field");
  const p = { m() { return 7 } };
  const o = { __proto__: p, x: 1 };
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern prototype-set");
  const p = { m() { return 7 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern prototype-set-with-field");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern prototype-reflect-set");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern prototype-proto-store");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  o.__proto__ = p;
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern prototype-two-levels");
  const p = { m() { return 7 } };
  const o = Object.create(Object.create(p));
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern prototype-of-class-instance");
  const p = { m() { return 7 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern prototype-is-instance");
  class C { m = function () { return 7 }; }
  const o = Object.create(new C());
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern stored-after");
  const o = {};
  o.m = function () { return 7 };
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return 7 };
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern stored-after-on-prototype");
  const p = {};
  p.m = function () { return 7 };
  const o = Object.create(p);
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return 7 };
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return 7 };
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return 7 };
  const o = new C();
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern constructor-function");
  function F() {}
  F.prototype.m = function () { return 7 };
  const o = new F();
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return 7 } };
  const o = new F();
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern constructor-function-this");
  function F() { this.m = function () { return 7 }; }
  const o = new F();
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern getter");
  const o = { get m() { return function () { return 7 }; } };
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return 7 } });
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern assigned");
  const o = Object.assign({}, { m() { return 7 } });
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern spread-copy");
  const o = { ...{ m() { return 7 } } };
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern made-in-function");
  function make() { return { m() { return 7 } }; }
  const o = make();
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern made-in-function-twice");
  function make() { return { m() { return 7 } }; }
  make();
  const o = make();
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern literal-arrow");
  const o = { m: () => { return 7 } };
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern class-field-arrow");
  class C { m = () => { return 7 }; }
  const o = new C();
  const { m } = o; print(m());
}
{
  const print = printer("call-pattern prototype-create-arrow");
  const p = { m: () => { return 7 } };
  const o = Object.create(p);
  const { m } = o; print(m());
}
{
  const print = printer("call-variable literal");
  const o = { m() { return 7 } };
  const f = o.m; print(f());
}
{
  const print = printer("call-variable literal-function");
  const o = { m: function () { return 7 } };
  const f = o.m; print(f());
}
{
  const print = printer("call-variable literal-with-field");
  const o = { x: 1, m() { return 7 } };
  const f = o.m; print(f());
}
{
  const print = printer("call-variable class-method");
  class C { m() { return 7 } }
  const o = new C();
  const f = o.m; print(f());
}
{
  const print = printer("call-variable class-field");
  class C { m = function () { return 7 }; }
  const o = new C();
  const f = o.m; print(f());
}
{
  const print = printer("call-variable subclass");
  class B { m() { return 7 } }
  class C extends B {}
  const o = new C();
  const f = o.m; print(f());
}
{
  const print = printer("call-variable class-static");
  class C { static m() { return 7 } }
  const o = C;
  const f = o.m; print(f());
}
{
  const print = printer("call-variable prototype-create");
  const p = { m() { return 7 } };
  const o = Object.create(p);
  const f = o.m; print(f());
}
{
  const print = printer("call-variable prototype-literal");
  const p = { m() { return 7 } };
  const o = { __proto__: p };
  const f = o.m; print(f());
}
{
  const print = printer("call-variable prototype-literal-with-field");
  const p = { m() { return 7 } };
  const o = { __proto__: p, x: 1 };
  const f = o.m; print(f());
}
{
  const print = printer("call-variable prototype-set");
  const p = { m() { return 7 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  const f = o.m; print(f());
}
{
  const print = printer("call-variable prototype-set-with-field");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const f = o.m; print(f());
}
{
  const print = printer("call-variable prototype-reflect-set");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  const f = o.m; print(f());
}
{
  const print = printer("call-variable prototype-proto-store");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  o.__proto__ = p;
  const f = o.m; print(f());
}
{
  const print = printer("call-variable prototype-two-levels");
  const p = { m() { return 7 } };
  const o = Object.create(Object.create(p));
  const f = o.m; print(f());
}
{
  const print = printer("call-variable prototype-of-class-instance");
  const p = { m() { return 7 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  const f = o.m; print(f());
}
{
  const print = printer("call-variable prototype-is-instance");
  class C { m = function () { return 7 }; }
  const o = Object.create(new C());
  const f = o.m; print(f());
}
{
  const print = printer("call-variable stored-after");
  const o = {};
  o.m = function () { return 7 };
  const f = o.m; print(f());
}
{
  const print = printer("call-variable stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return 7 };
  const f = o.m; print(f());
}
{
  const print = printer("call-variable stored-after-on-prototype");
  const p = {};
  p.m = function () { return 7 };
  const o = Object.create(p);
  const f = o.m; print(f());
}
{
  const print = printer("call-variable stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return 7 };
  const f = o.m; print(f());
}
{
  const print = printer("call-variable stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return 7 };
  const f = o.m; print(f());
}
{
  const print = printer("call-variable stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return 7 };
  const o = new C();
  const f = o.m; print(f());
}
{
  const print = printer("call-variable constructor-function");
  function F() {}
  F.prototype.m = function () { return 7 };
  const o = new F();
  const f = o.m; print(f());
}
{
  const print = printer("call-variable constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return 7 } };
  const o = new F();
  const f = o.m; print(f());
}
{
  const print = printer("call-variable constructor-function-this");
  function F() { this.m = function () { return 7 }; }
  const o = new F();
  const f = o.m; print(f());
}
{
  const print = printer("call-variable getter");
  const o = { get m() { return function () { return 7 }; } };
  const f = o.m; print(f());
}
{
  const print = printer("call-variable defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return 7 } });
  const f = o.m; print(f());
}
{
  const print = printer("call-variable assigned");
  const o = Object.assign({}, { m() { return 7 } });
  const f = o.m; print(f());
}
{
  const print = printer("call-variable spread-copy");
  const o = { ...{ m() { return 7 } } };
  const f = o.m; print(f());
}
{
  const print = printer("call-variable made-in-function");
  function make() { return { m() { return 7 } }; }
  const o = make();
  const f = o.m; print(f());
}
{
  const print = printer("call-variable made-in-function-twice");
  function make() { return { m() { return 7 } }; }
  make();
  const o = make();
  const f = o.m; print(f());
}
{
  const print = printer("call-variable literal-arrow");
  const o = { m: () => { return 7 } };
  const f = o.m; print(f());
}
{
  const print = printer("call-variable class-field-arrow");
  class C { m = () => { return 7 }; }
  const o = new C();
  const f = o.m; print(f());
}
{
  const print = printer("call-variable prototype-create-arrow");
  const p = { m: () => { return 7 } };
  const o = Object.create(p);
  const f = o.m; print(f());
}
{
  const print = printer("call-typeof literal");
  const o = { m() { return 7 } };
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof literal-function");
  const o = { m: function () { return 7 } };
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof literal-with-field");
  const o = { x: 1, m() { return 7 } };
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof class-method");
  class C { m() { return 7 } }
  const o = new C();
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof class-field");
  class C { m = function () { return 7 }; }
  const o = new C();
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof subclass");
  class B { m() { return 7 } }
  class C extends B {}
  const o = new C();
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof class-static");
  class C { static m() { return 7 } }
  const o = C;
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof prototype-create");
  const p = { m() { return 7 } };
  const o = Object.create(p);
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof prototype-literal");
  const p = { m() { return 7 } };
  const o = { __proto__: p };
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof prototype-literal-with-field");
  const p = { m() { return 7 } };
  const o = { __proto__: p, x: 1 };
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof prototype-set");
  const p = { m() { return 7 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof prototype-set-with-field");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof prototype-reflect-set");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof prototype-proto-store");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof prototype-two-levels");
  const p = { m() { return 7 } };
  const o = Object.create(Object.create(p));
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof prototype-of-class-instance");
  const p = { m() { return 7 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof prototype-is-instance");
  class C { m = function () { return 7 }; }
  const o = Object.create(new C());
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof stored-after");
  const o = {};
  o.m = function () { return 7 };
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return 7 };
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof stored-after-on-prototype");
  const p = {};
  p.m = function () { return 7 };
  const o = Object.create(p);
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return 7 };
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return 7 };
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return 7 };
  const o = new C();
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof constructor-function");
  function F() {}
  F.prototype.m = function () { return 7 };
  const o = new F();
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return 7 } };
  const o = new F();
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof constructor-function-this");
  function F() { this.m = function () { return 7 }; }
  const o = new F();
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof getter");
  const o = { get m() { return function () { return 7 }; } };
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return 7 } });
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof assigned");
  const o = Object.assign({}, { m() { return 7 } });
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof spread-copy");
  const o = { ...{ m() { return 7 } } };
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof made-in-function");
  function make() { return { m() { return 7 } }; }
  const o = make();
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof made-in-function-twice");
  function make() { return { m() { return 7 } }; }
  make();
  const o = make();
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof literal-arrow");
  const o = { m: () => { return 7 } };
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof class-field-arrow");
  class C { m = () => { return 7 }; }
  const o = new C();
  print(typeof o.m, o.m());
}
{
  const print = printer("call-typeof prototype-create-arrow");
  const p = { m: () => { return 7 } };
  const o = Object.create(p);
  print(typeof o.m, o.m());
}
{
  const print = printer("call-in literal");
  const o = { m() { return 7 } };
  print("m" in o, o.m());
}
{
  const print = printer("call-in literal-function");
  const o = { m: function () { return 7 } };
  print("m" in o, o.m());
}
{
  const print = printer("call-in literal-with-field");
  const o = { x: 1, m() { return 7 } };
  print("m" in o, o.m());
}
{
  const print = printer("call-in class-method");
  class C { m() { return 7 } }
  const o = new C();
  print("m" in o, o.m());
}
{
  const print = printer("call-in class-field");
  class C { m = function () { return 7 }; }
  const o = new C();
  print("m" in o, o.m());
}
{
  const print = printer("call-in subclass");
  class B { m() { return 7 } }
  class C extends B {}
  const o = new C();
  print("m" in o, o.m());
}
{
  const print = printer("call-in class-static");
  class C { static m() { return 7 } }
  const o = C;
  print("m" in o, o.m());
}
{
  const print = printer("call-in prototype-create");
  const p = { m() { return 7 } };
  const o = Object.create(p);
  print("m" in o, o.m());
}
{
  const print = printer("call-in prototype-literal");
  const p = { m() { return 7 } };
  const o = { __proto__: p };
  print("m" in o, o.m());
}
{
  const print = printer("call-in prototype-literal-with-field");
  const p = { m() { return 7 } };
  const o = { __proto__: p, x: 1 };
  print("m" in o, o.m());
}
{
  const print = printer("call-in prototype-set");
  const p = { m() { return 7 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print("m" in o, o.m());
}
{
  const print = printer("call-in prototype-set-with-field");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print("m" in o, o.m());
}
{
  const print = printer("call-in prototype-reflect-set");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print("m" in o, o.m());
}
{
  const print = printer("call-in prototype-proto-store");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  o.__proto__ = p;
  print("m" in o, o.m());
}
{
  const print = printer("call-in prototype-two-levels");
  const p = { m() { return 7 } };
  const o = Object.create(Object.create(p));
  print("m" in o, o.m());
}
{
  const print = printer("call-in prototype-of-class-instance");
  const p = { m() { return 7 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print("m" in o, o.m());
}
{
  const print = printer("call-in prototype-is-instance");
  class C { m = function () { return 7 }; }
  const o = Object.create(new C());
  print("m" in o, o.m());
}
{
  const print = printer("call-in stored-after");
  const o = {};
  o.m = function () { return 7 };
  print("m" in o, o.m());
}
{
  const print = printer("call-in stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return 7 };
  print("m" in o, o.m());
}
{
  const print = printer("call-in stored-after-on-prototype");
  const p = {};
  p.m = function () { return 7 };
  const o = Object.create(p);
  print("m" in o, o.m());
}
{
  const print = printer("call-in stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return 7 };
  print("m" in o, o.m());
}
{
  const print = printer("call-in stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return 7 };
  print("m" in o, o.m());
}
{
  const print = printer("call-in stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return 7 };
  const o = new C();
  print("m" in o, o.m());
}
{
  const print = printer("call-in constructor-function");
  function F() {}
  F.prototype.m = function () { return 7 };
  const o = new F();
  print("m" in o, o.m());
}
{
  const print = printer("call-in constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return 7 } };
  const o = new F();
  print("m" in o, o.m());
}
{
  const print = printer("call-in constructor-function-this");
  function F() { this.m = function () { return 7 }; }
  const o = new F();
  print("m" in o, o.m());
}
{
  const print = printer("call-in getter");
  const o = { get m() { return function () { return 7 }; } };
  print("m" in o, o.m());
}
{
  const print = printer("call-in defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return 7 } });
  print("m" in o, o.m());
}
{
  const print = printer("call-in assigned");
  const o = Object.assign({}, { m() { return 7 } });
  print("m" in o, o.m());
}
{
  const print = printer("call-in spread-copy");
  const o = { ...{ m() { return 7 } } };
  print("m" in o, o.m());
}
{
  const print = printer("call-in made-in-function");
  function make() { return { m() { return 7 } }; }
  const o = make();
  print("m" in o, o.m());
}
{
  const print = printer("call-in made-in-function-twice");
  function make() { return { m() { return 7 } }; }
  make();
  const o = make();
  print("m" in o, o.m());
}
{
  const print = printer("call-in literal-arrow");
  const o = { m: () => { return 7 } };
  print("m" in o, o.m());
}
{
  const print = printer("call-in class-field-arrow");
  class C { m = () => { return 7 }; }
  const o = new C();
  print("m" in o, o.m());
}
{
  const print = printer("call-in prototype-create-arrow");
  const p = { m: () => { return 7 } };
  const o = Object.create(p);
  print("m" in o, o.m());
}
{
  const print = printer("call-twice literal");
  const o = { m() { return 7 } };
  print(o.m() + o.m());
}
{
  const print = printer("call-twice literal-function");
  const o = { m: function () { return 7 } };
  print(o.m() + o.m());
}
{
  const print = printer("call-twice literal-with-field");
  const o = { x: 1, m() { return 7 } };
  print(o.m() + o.m());
}
{
  const print = printer("call-twice class-method");
  class C { m() { return 7 } }
  const o = new C();
  print(o.m() + o.m());
}
{
  const print = printer("call-twice class-field");
  class C { m = function () { return 7 }; }
  const o = new C();
  print(o.m() + o.m());
}
{
  const print = printer("call-twice subclass");
  class B { m() { return 7 } }
  class C extends B {}
  const o = new C();
  print(o.m() + o.m());
}
{
  const print = printer("call-twice class-static");
  class C { static m() { return 7 } }
  const o = C;
  print(o.m() + o.m());
}
{
  const print = printer("call-twice prototype-create");
  const p = { m() { return 7 } };
  const o = Object.create(p);
  print(o.m() + o.m());
}
{
  const print = printer("call-twice prototype-literal");
  const p = { m() { return 7 } };
  const o = { __proto__: p };
  print(o.m() + o.m());
}
{
  const print = printer("call-twice prototype-literal-with-field");
  const p = { m() { return 7 } };
  const o = { __proto__: p, x: 1 };
  print(o.m() + o.m());
}
{
  const print = printer("call-twice prototype-set");
  const p = { m() { return 7 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(o.m() + o.m());
}
{
  const print = printer("call-twice prototype-set-with-field");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(o.m() + o.m());
}
{
  const print = printer("call-twice prototype-reflect-set");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(o.m() + o.m());
}
{
  const print = printer("call-twice prototype-proto-store");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(o.m() + o.m());
}
{
  const print = printer("call-twice prototype-two-levels");
  const p = { m() { return 7 } };
  const o = Object.create(Object.create(p));
  print(o.m() + o.m());
}
{
  const print = printer("call-twice prototype-of-class-instance");
  const p = { m() { return 7 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(o.m() + o.m());
}
{
  const print = printer("call-twice prototype-is-instance");
  class C { m = function () { return 7 }; }
  const o = Object.create(new C());
  print(o.m() + o.m());
}
{
  const print = printer("call-twice stored-after");
  const o = {};
  o.m = function () { return 7 };
  print(o.m() + o.m());
}
{
  const print = printer("call-twice stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return 7 };
  print(o.m() + o.m());
}
{
  const print = printer("call-twice stored-after-on-prototype");
  const p = {};
  p.m = function () { return 7 };
  const o = Object.create(p);
  print(o.m() + o.m());
}
{
  const print = printer("call-twice stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return 7 };
  print(o.m() + o.m());
}
{
  const print = printer("call-twice stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return 7 };
  print(o.m() + o.m());
}
{
  const print = printer("call-twice stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return 7 };
  const o = new C();
  print(o.m() + o.m());
}
{
  const print = printer("call-twice constructor-function");
  function F() {}
  F.prototype.m = function () { return 7 };
  const o = new F();
  print(o.m() + o.m());
}
{
  const print = printer("call-twice constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return 7 } };
  const o = new F();
  print(o.m() + o.m());
}
{
  const print = printer("call-twice constructor-function-this");
  function F() { this.m = function () { return 7 }; }
  const o = new F();
  print(o.m() + o.m());
}
{
  const print = printer("call-twice getter");
  const o = { get m() { return function () { return 7 }; } };
  print(o.m() + o.m());
}
{
  const print = printer("call-twice defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return 7 } });
  print(o.m() + o.m());
}
{
  const print = printer("call-twice assigned");
  const o = Object.assign({}, { m() { return 7 } });
  print(o.m() + o.m());
}
{
  const print = printer("call-twice spread-copy");
  const o = { ...{ m() { return 7 } } };
  print(o.m() + o.m());
}
{
  const print = printer("call-twice made-in-function");
  function make() { return { m() { return 7 } }; }
  const o = make();
  print(o.m() + o.m());
}
{
  const print = printer("call-twice made-in-function-twice");
  function make() { return { m() { return 7 } }; }
  make();
  const o = make();
  print(o.m() + o.m());
}
{
  const print = printer("call-twice literal-arrow");
  const o = { m: () => { return 7 } };
  print(o.m() + o.m());
}
{
  const print = printer("call-twice class-field-arrow");
  class C { m = () => { return 7 }; }
  const o = new C();
  print(o.m() + o.m());
}
{
  const print = printer("call-twice prototype-create-arrow");
  const p = { m: () => { return 7 } };
  const o = Object.create(p);
  print(o.m() + o.m());
}
{
  const print = printer("call-in-function literal");
  const o = { m() { return 7 } };
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function literal-function");
  const o = { m: function () { return 7 } };
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function literal-with-field");
  const o = { x: 1, m() { return 7 } };
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function class-method");
  class C { m() { return 7 } }
  const o = new C();
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function class-field");
  class C { m = function () { return 7 }; }
  const o = new C();
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function subclass");
  class B { m() { return 7 } }
  class C extends B {}
  const o = new C();
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function class-static");
  class C { static m() { return 7 } }
  const o = C;
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function prototype-create");
  const p = { m() { return 7 } };
  const o = Object.create(p);
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function prototype-literal");
  const p = { m() { return 7 } };
  const o = { __proto__: p };
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function prototype-literal-with-field");
  const p = { m() { return 7 } };
  const o = { __proto__: p, x: 1 };
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function prototype-set");
  const p = { m() { return 7 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function prototype-set-with-field");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function prototype-reflect-set");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function prototype-proto-store");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  o.__proto__ = p;
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function prototype-two-levels");
  const p = { m() { return 7 } };
  const o = Object.create(Object.create(p));
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function prototype-of-class-instance");
  const p = { m() { return 7 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function prototype-is-instance");
  class C { m = function () { return 7 }; }
  const o = Object.create(new C());
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function stored-after");
  const o = {};
  o.m = function () { return 7 };
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return 7 };
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function stored-after-on-prototype");
  const p = {};
  p.m = function () { return 7 };
  const o = Object.create(p);
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return 7 };
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return 7 };
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return 7 };
  const o = new C();
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function constructor-function");
  function F() {}
  F.prototype.m = function () { return 7 };
  const o = new F();
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return 7 } };
  const o = new F();
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function constructor-function-this");
  function F() { this.m = function () { return 7 }; }
  const o = new F();
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function getter");
  const o = { get m() { return function () { return 7 }; } };
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return 7 } });
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function assigned");
  const o = Object.assign({}, { m() { return 7 } });
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function spread-copy");
  const o = { ...{ m() { return 7 } } };
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function made-in-function");
  function make() { return { m() { return 7 } }; }
  const o = make();
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function made-in-function-twice");
  function make() { return { m() { return 7 } }; }
  make();
  const o = make();
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function literal-arrow");
  const o = { m: () => { return 7 } };
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function class-field-arrow");
  class C { m = () => { return 7 }; }
  const o = new C();
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-function prototype-create-arrow");
  const p = { m: () => { return 7 } };
  const o = Object.create(p);
  function run(x) { return x.m(); } print(run(o)); print(run(o));
}
{
  const print = printer("call-in-loop literal");
  const o = { m() { return 7 } };
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop literal-function");
  const o = { m: function () { return 7 } };
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop literal-with-field");
  const o = { x: 1, m() { return 7 } };
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop class-method");
  class C { m() { return 7 } }
  const o = new C();
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop class-field");
  class C { m = function () { return 7 }; }
  const o = new C();
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop subclass");
  class B { m() { return 7 } }
  class C extends B {}
  const o = new C();
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop class-static");
  class C { static m() { return 7 } }
  const o = C;
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop prototype-create");
  const p = { m() { return 7 } };
  const o = Object.create(p);
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop prototype-literal");
  const p = { m() { return 7 } };
  const o = { __proto__: p };
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop prototype-literal-with-field");
  const p = { m() { return 7 } };
  const o = { __proto__: p, x: 1 };
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop prototype-set");
  const p = { m() { return 7 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop prototype-set-with-field");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop prototype-reflect-set");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop prototype-proto-store");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  o.__proto__ = p;
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop prototype-two-levels");
  const p = { m() { return 7 } };
  const o = Object.create(Object.create(p));
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop prototype-of-class-instance");
  const p = { m() { return 7 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop prototype-is-instance");
  class C { m = function () { return 7 }; }
  const o = Object.create(new C());
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop stored-after");
  const o = {};
  o.m = function () { return 7 };
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return 7 };
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop stored-after-on-prototype");
  const p = {};
  p.m = function () { return 7 };
  const o = Object.create(p);
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return 7 };
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return 7 };
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return 7 };
  const o = new C();
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop constructor-function");
  function F() {}
  F.prototype.m = function () { return 7 };
  const o = new F();
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return 7 } };
  const o = new F();
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop constructor-function-this");
  function F() { this.m = function () { return 7 }; }
  const o = new F();
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop getter");
  const o = { get m() { return function () { return 7 }; } };
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return 7 } });
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop assigned");
  const o = Object.assign({}, { m() { return 7 } });
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop spread-copy");
  const o = { ...{ m() { return 7 } } };
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop made-in-function");
  function make() { return { m() { return 7 } }; }
  const o = make();
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop made-in-function-twice");
  function make() { return { m() { return 7 } }; }
  make();
  const o = make();
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop literal-arrow");
  const o = { m: () => { return 7 } };
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop class-field-arrow");
  class C { m = () => { return 7 }; }
  const o = new C();
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-in-loop prototype-create-arrow");
  const p = { m: () => { return 7 } };
  const o = Object.create(p);
  let s = 0; for (let i = 0; i < 100; i++) s += o.m(); print(s);
}
{
  const print = printer("call-two-receivers literal");
  const o = { m() { return 7 } };
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers literal-function");
  const o = { m: function () { return 7 } };
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers literal-with-field");
  const o = { x: 1, m() { return 7 } };
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers class-method");
  class C { m() { return 7 } }
  const o = new C();
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers class-field");
  class C { m = function () { return 7 }; }
  const o = new C();
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers subclass");
  class B { m() { return 7 } }
  class C extends B {}
  const o = new C();
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers class-static");
  class C { static m() { return 7 } }
  const o = C;
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers prototype-create");
  const p = { m() { return 7 } };
  const o = Object.create(p);
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers prototype-literal");
  const p = { m() { return 7 } };
  const o = { __proto__: p };
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers prototype-literal-with-field");
  const p = { m() { return 7 } };
  const o = { __proto__: p, x: 1 };
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers prototype-set");
  const p = { m() { return 7 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers prototype-set-with-field");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers prototype-reflect-set");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers prototype-proto-store");
  const p = { m() { return 7 } };
  const o = { x: 1 };
  o.__proto__ = p;
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers prototype-two-levels");
  const p = { m() { return 7 } };
  const o = Object.create(Object.create(p));
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers prototype-of-class-instance");
  const p = { m() { return 7 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers prototype-is-instance");
  class C { m = function () { return 7 }; }
  const o = Object.create(new C());
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers stored-after");
  const o = {};
  o.m = function () { return 7 };
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return 7 };
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers stored-after-on-prototype");
  const p = {};
  p.m = function () { return 7 };
  const o = Object.create(p);
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return 7 };
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return 7 };
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return 7 };
  const o = new C();
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers constructor-function");
  function F() {}
  F.prototype.m = function () { return 7 };
  const o = new F();
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return 7 } };
  const o = new F();
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers constructor-function-this");
  function F() { this.m = function () { return 7 }; }
  const o = new F();
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers getter");
  const o = { get m() { return function () { return 7 }; } };
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return 7 } });
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers assigned");
  const o = Object.assign({}, { m() { return 7 } });
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers spread-copy");
  const o = { ...{ m() { return 7 } } };
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers made-in-function");
  function make() { return { m() { return 7 } }; }
  const o = make();
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers made-in-function-twice");
  function make() { return { m() { return 7 } }; }
  make();
  const o = make();
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers literal-arrow");
  const o = { m: () => { return 7 } };
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers class-field-arrow");
  class C { m = () => { return 7 }; }
  const o = new C();
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-two-receivers prototype-create-arrow");
  const p = { m: () => { return 7 } };
  const o = Object.create(p);
  const other = { m() { return 8 } }; function run(x) { return x.m(); } print(run(o)); print(run(other));
}
{
  const print = printer("call-this literal");
  const o = { m() { return this === o } };
  print(o.m());
}
{
  const print = printer("call-this literal-function");
  const o = { m: function () { return this === o } };
  print(o.m());
}
{
  const print = printer("call-this literal-with-field");
  const o = { x: 1, m() { return this === o } };
  print(o.m());
}
{
  const print = printer("call-this class-method");
  class C { m() { return this === o } }
  const o = new C();
  print(o.m());
}
{
  const print = printer("call-this class-field");
  class C { m = function () { return this === o }; }
  const o = new C();
  print(o.m());
}
{
  const print = printer("call-this subclass");
  class B { m() { return this === o } }
  class C extends B {}
  const o = new C();
  print(o.m());
}
{
  const print = printer("call-this class-static");
  class C { static m() { return this === o } }
  const o = C;
  print(o.m());
}
{
  const print = printer("call-this prototype-create");
  const p = { m() { return this === o } };
  const o = Object.create(p);
  print(o.m());
}
{
  const print = printer("call-this prototype-literal");
  const p = { m() { return this === o } };
  const o = { __proto__: p };
  print(o.m());
}
{
  const print = printer("call-this prototype-literal-with-field");
  const p = { m() { return this === o } };
  const o = { __proto__: p, x: 1 };
  print(o.m());
}
{
  const print = printer("call-this prototype-set");
  const p = { m() { return this === o } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(o.m());
}
{
  const print = printer("call-this prototype-set-with-field");
  const p = { m() { return this === o } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(o.m());
}
{
  const print = printer("call-this prototype-reflect-set");
  const p = { m() { return this === o } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(o.m());
}
{
  const print = printer("call-this prototype-proto-store");
  const p = { m() { return this === o } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(o.m());
}
{
  const print = printer("call-this prototype-two-levels");
  const p = { m() { return this === o } };
  const o = Object.create(Object.create(p));
  print(o.m());
}
{
  const print = printer("call-this prototype-of-class-instance");
  const p = { m() { return this === o } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(o.m());
}
{
  const print = printer("call-this prototype-is-instance");
  class C { m = function () { return this === o }; }
  const o = Object.create(new C());
  print(o.m());
}
{
  const print = printer("call-this stored-after");
  const o = {};
  o.m = function () { return this === o };
  print(o.m());
}
{
  const print = printer("call-this stored-after-with-field");
  const o = { x: 1 };
  o.m = function () { return this === o };
  print(o.m());
}
{
  const print = printer("call-this stored-after-on-prototype");
  const p = {};
  p.m = function () { return this === o };
  const o = Object.create(p);
  print(o.m());
}
{
  const print = printer("call-this stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.m = function () { return this === o };
  print(o.m());
}
{
  const print = printer("call-this stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.m = function () { return this === o };
  print(o.m());
}
{
  const print = printer("call-this stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.m = function () { return this === o };
  const o = new C();
  print(o.m());
}
{
  const print = printer("call-this constructor-function");
  function F() {}
  F.prototype.m = function () { return this === o };
  const o = new F();
  print(o.m());
}
{
  const print = printer("call-this constructor-function-prototype-object");
  function F() {}
  F.prototype = { m() { return this === o } };
  const o = new F();
  print(o.m());
}
{
  const print = printer("call-this constructor-function-this");
  function F() { this.m = function () { return this === o }; }
  const o = new F();
  print(o.m());
}
{
  const print = printer("call-this getter");
  const o = { get m() { return function () { return this === o }; } };
  print(o.m());
}
{
  const print = printer("call-this defined");
  const o = {};
  Object.defineProperty(o, "m", { value: function () { return this === o } });
  print(o.m());
}
{
  const print = printer("call-this assigned");
  const o = Object.assign({}, { m() { return this === o } });
  print(o.m());
}
{
  const print = printer("call-this spread-copy");
  const o = { ...{ m() { return this === o } } };
  print(o.m());
}
{
  const print = printer("call-this made-in-function");
  function make() { return { m() { return this === o } }; }
  const o = make();
  print(o.m());
}
{
  const print = printer("call-this made-in-function-twice");
  function make() { return { m() { return this === o } }; }
  make();
  const o = make();
  print(o.m());
}

console.log(lines.join("\n"));
