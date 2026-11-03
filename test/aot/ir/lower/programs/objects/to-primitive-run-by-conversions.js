// RUN: lower
// OPTIONS: builtin-modules

// Symbol.toPrimitive is run by every conversion, wherever the object got it from.
const lines = [];
function printer(label) {
  return (...values) => {
    let text = label + ":";
    for (let i = 0; i < values.length; i++) text += " " + String(values[i]);
    lines.push(text);
  };
}

{
  const print = printer("toprimitive-add literal");
  const o = { [Symbol.toPrimitive](hint) { return hint } };
  print(o + 1);
}
{
  const print = printer("toprimitive-add literal-function");
  const o = { [Symbol.toPrimitive]: function (hint) { return hint } };
  print(o + 1);
}
{
  const print = printer("toprimitive-add literal-with-field");
  const o = { x: 1, [Symbol.toPrimitive](hint) { return hint } };
  print(o + 1);
}
{
  const print = printer("toprimitive-add class-method");
  class C { [Symbol.toPrimitive](hint) { return hint } }
  const o = new C();
  print(o + 1);
}
{
  const print = printer("toprimitive-add class-field");
  class C { [Symbol.toPrimitive] = function (hint) { return hint }; }
  const o = new C();
  print(o + 1);
}
{
  const print = printer("toprimitive-add subclass");
  class B { [Symbol.toPrimitive](hint) { return hint } }
  class C extends B {}
  const o = new C();
  print(o + 1);
}
{
  const print = printer("toprimitive-add class-static");
  class C { static [Symbol.toPrimitive](hint) { return hint } }
  const o = C;
  print(o + 1);
}
{
  const print = printer("toprimitive-add prototype-create");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = Object.create(p);
  print(o + 1);
}
{
  const print = printer("toprimitive-add prototype-literal");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { __proto__: p };
  print(o + 1);
}
{
  const print = printer("toprimitive-add prototype-literal-with-field");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { __proto__: p, x: 1 };
  print(o + 1);
}
{
  const print = printer("toprimitive-add prototype-set");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(o + 1);
}
{
  const print = printer("toprimitive-add prototype-set-with-field");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(o + 1);
}
{
  const print = printer("toprimitive-add prototype-reflect-set");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(o + 1);
}
{
  const print = printer("toprimitive-add prototype-proto-store");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(o + 1);
}
{
  const print = printer("toprimitive-add prototype-two-levels");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = Object.create(Object.create(p));
  print(o + 1);
}
{
  const print = printer("toprimitive-add prototype-of-class-instance");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(o + 1);
}
{
  const print = printer("toprimitive-add prototype-is-instance");
  class C { [Symbol.toPrimitive] = function (hint) { return hint }; }
  const o = Object.create(new C());
  print(o + 1);
}
{
  const print = printer("toprimitive-add stored-after");
  const o = {};
  o[Symbol.toPrimitive] = function (hint) { return hint };
  print(o + 1);
}
{
  const print = printer("toprimitive-add stored-after-with-field");
  const o = { x: 1 };
  o[Symbol.toPrimitive] = function (hint) { return hint };
  print(o + 1);
}
{
  const print = printer("toprimitive-add stored-after-on-prototype");
  const p = {};
  p[Symbol.toPrimitive] = function (hint) { return hint };
  const o = Object.create(p);
  print(o + 1);
}
{
  const print = printer("toprimitive-add stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p[Symbol.toPrimitive] = function (hint) { return hint };
  print(o + 1);
}
{
  const print = printer("toprimitive-add stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o[Symbol.toPrimitive] = function (hint) { return hint };
  print(o + 1);
}
{
  const print = printer("toprimitive-add stored-on-class-prototype");
  class C { x = 1; }
  C.prototype[Symbol.toPrimitive] = function (hint) { return hint };
  const o = new C();
  print(o + 1);
}
{
  const print = printer("toprimitive-add constructor-function");
  function F() {}
  F.prototype[Symbol.toPrimitive] = function (hint) { return hint };
  const o = new F();
  print(o + 1);
}
{
  const print = printer("toprimitive-add constructor-function-prototype-object");
  function F() {}
  F.prototype = { [Symbol.toPrimitive](hint) { return hint } };
  const o = new F();
  print(o + 1);
}
{
  const print = printer("toprimitive-add constructor-function-this");
  function F() { this[Symbol.toPrimitive] = function (hint) { return hint }; }
  const o = new F();
  print(o + 1);
}
{
  const print = printer("toprimitive-add getter");
  const o = { get [Symbol.toPrimitive]() { return function (hint) { return hint }; } };
  print(o + 1);
}
{
  const print = printer("toprimitive-add defined");
  const o = {};
  Object.defineProperty(o, Symbol.toPrimitive, { value: function (hint) { return hint } });
  print(o + 1);
}
{
  const print = printer("toprimitive-add assigned");
  const o = Object.assign({}, { [Symbol.toPrimitive](hint) { return hint } });
  print(o + 1);
}
{
  const print = printer("toprimitive-add spread-copy");
  const o = { ...{ [Symbol.toPrimitive](hint) { return hint } } };
  print(o + 1);
}
{
  const print = printer("toprimitive-add made-in-function");
  function make() { return { [Symbol.toPrimitive](hint) { return hint } }; }
  const o = make();
  print(o + 1);
}
{
  const print = printer("toprimitive-add made-in-function-twice");
  function make() { return { [Symbol.toPrimitive](hint) { return hint } }; }
  make();
  const o = make();
  print(o + 1);
}
{
  const print = printer("toprimitive-add literal-arrow");
  const o = { [Symbol.toPrimitive]: (hint) => { return hint } };
  print(o + 1);
}
{
  const print = printer("toprimitive-add class-field-arrow");
  class C { [Symbol.toPrimitive] = (hint) => { return hint }; }
  const o = new C();
  print(o + 1);
}
{
  const print = printer("toprimitive-add prototype-create-arrow");
  const p = { [Symbol.toPrimitive]: (hint) => { return hint } };
  const o = Object.create(p);
  print(o + 1);
}
{
  const print = printer("toprimitive-template literal");
  const o = { [Symbol.toPrimitive](hint) { return hint } };
  print(`${o}`);
}
{
  const print = printer("toprimitive-template literal-function");
  const o = { [Symbol.toPrimitive]: function (hint) { return hint } };
  print(`${o}`);
}
{
  const print = printer("toprimitive-template literal-with-field");
  const o = { x: 1, [Symbol.toPrimitive](hint) { return hint } };
  print(`${o}`);
}
{
  const print = printer("toprimitive-template class-method");
  class C { [Symbol.toPrimitive](hint) { return hint } }
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("toprimitive-template class-field");
  class C { [Symbol.toPrimitive] = function (hint) { return hint }; }
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("toprimitive-template subclass");
  class B { [Symbol.toPrimitive](hint) { return hint } }
  class C extends B {}
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("toprimitive-template class-static");
  class C { static [Symbol.toPrimitive](hint) { return hint } }
  const o = C;
  print(`${o}`);
}
{
  const print = printer("toprimitive-template prototype-create");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = Object.create(p);
  print(`${o}`);
}
{
  const print = printer("toprimitive-template prototype-literal");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { __proto__: p };
  print(`${o}`);
}
{
  const print = printer("toprimitive-template prototype-literal-with-field");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { __proto__: p, x: 1 };
  print(`${o}`);
}
{
  const print = printer("toprimitive-template prototype-set");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(`${o}`);
}
{
  const print = printer("toprimitive-template prototype-set-with-field");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(`${o}`);
}
{
  const print = printer("toprimitive-template prototype-reflect-set");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(`${o}`);
}
{
  const print = printer("toprimitive-template prototype-proto-store");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(`${o}`);
}
{
  const print = printer("toprimitive-template prototype-two-levels");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = Object.create(Object.create(p));
  print(`${o}`);
}
{
  const print = printer("toprimitive-template prototype-of-class-instance");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("toprimitive-template prototype-is-instance");
  class C { [Symbol.toPrimitive] = function (hint) { return hint }; }
  const o = Object.create(new C());
  print(`${o}`);
}
{
  const print = printer("toprimitive-template stored-after");
  const o = {};
  o[Symbol.toPrimitive] = function (hint) { return hint };
  print(`${o}`);
}
{
  const print = printer("toprimitive-template stored-after-with-field");
  const o = { x: 1 };
  o[Symbol.toPrimitive] = function (hint) { return hint };
  print(`${o}`);
}
{
  const print = printer("toprimitive-template stored-after-on-prototype");
  const p = {};
  p[Symbol.toPrimitive] = function (hint) { return hint };
  const o = Object.create(p);
  print(`${o}`);
}
{
  const print = printer("toprimitive-template stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p[Symbol.toPrimitive] = function (hint) { return hint };
  print(`${o}`);
}
{
  const print = printer("toprimitive-template stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o[Symbol.toPrimitive] = function (hint) { return hint };
  print(`${o}`);
}
{
  const print = printer("toprimitive-template stored-on-class-prototype");
  class C { x = 1; }
  C.prototype[Symbol.toPrimitive] = function (hint) { return hint };
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("toprimitive-template constructor-function");
  function F() {}
  F.prototype[Symbol.toPrimitive] = function (hint) { return hint };
  const o = new F();
  print(`${o}`);
}
{
  const print = printer("toprimitive-template constructor-function-prototype-object");
  function F() {}
  F.prototype = { [Symbol.toPrimitive](hint) { return hint } };
  const o = new F();
  print(`${o}`);
}
{
  const print = printer("toprimitive-template constructor-function-this");
  function F() { this[Symbol.toPrimitive] = function (hint) { return hint }; }
  const o = new F();
  print(`${o}`);
}
{
  const print = printer("toprimitive-template getter");
  const o = { get [Symbol.toPrimitive]() { return function (hint) { return hint }; } };
  print(`${o}`);
}
{
  const print = printer("toprimitive-template defined");
  const o = {};
  Object.defineProperty(o, Symbol.toPrimitive, { value: function (hint) { return hint } });
  print(`${o}`);
}
{
  const print = printer("toprimitive-template assigned");
  const o = Object.assign({}, { [Symbol.toPrimitive](hint) { return hint } });
  print(`${o}`);
}
{
  const print = printer("toprimitive-template spread-copy");
  const o = { ...{ [Symbol.toPrimitive](hint) { return hint } } };
  print(`${o}`);
}
{
  const print = printer("toprimitive-template made-in-function");
  function make() { return { [Symbol.toPrimitive](hint) { return hint } }; }
  const o = make();
  print(`${o}`);
}
{
  const print = printer("toprimitive-template made-in-function-twice");
  function make() { return { [Symbol.toPrimitive](hint) { return hint } }; }
  make();
  const o = make();
  print(`${o}`);
}
{
  const print = printer("toprimitive-template literal-arrow");
  const o = { [Symbol.toPrimitive]: (hint) => { return hint } };
  print(`${o}`);
}
{
  const print = printer("toprimitive-template class-field-arrow");
  class C { [Symbol.toPrimitive] = (hint) => { return hint }; }
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("toprimitive-template prototype-create-arrow");
  const p = { [Symbol.toPrimitive]: (hint) => { return hint } };
  const o = Object.create(p);
  print(`${o}`);
}
{
  const print = printer("toprimitive-plus literal");
  const o = { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } };
  print(+o);
}
{
  const print = printer("toprimitive-plus literal-function");
  const o = { [Symbol.toPrimitive]: function (hint) { return hint === "number" ? 3 : 4 } };
  print(+o);
}
{
  const print = printer("toprimitive-plus literal-with-field");
  const o = { x: 1, [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } };
  print(+o);
}
{
  const print = printer("toprimitive-plus class-method");
  class C { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } }
  const o = new C();
  print(+o);
}
{
  const print = printer("toprimitive-plus class-field");
  class C { [Symbol.toPrimitive] = function (hint) { return hint === "number" ? 3 : 4 }; }
  const o = new C();
  print(+o);
}
{
  const print = printer("toprimitive-plus subclass");
  class B { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } }
  class C extends B {}
  const o = new C();
  print(+o);
}
{
  const print = printer("toprimitive-plus class-static");
  class C { static [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } }
  const o = C;
  print(+o);
}
{
  const print = printer("toprimitive-plus prototype-create");
  const p = { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } };
  const o = Object.create(p);
  print(+o);
}
{
  const print = printer("toprimitive-plus prototype-literal");
  const p = { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } };
  const o = { __proto__: p };
  print(+o);
}
{
  const print = printer("toprimitive-plus prototype-literal-with-field");
  const p = { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } };
  const o = { __proto__: p, x: 1 };
  print(+o);
}
{
  const print = printer("toprimitive-plus prototype-set");
  const p = { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(+o);
}
{
  const print = printer("toprimitive-plus prototype-set-with-field");
  const p = { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(+o);
}
{
  const print = printer("toprimitive-plus prototype-reflect-set");
  const p = { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(+o);
}
{
  const print = printer("toprimitive-plus prototype-proto-store");
  const p = { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(+o);
}
{
  const print = printer("toprimitive-plus prototype-two-levels");
  const p = { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } };
  const o = Object.create(Object.create(p));
  print(+o);
}
{
  const print = printer("toprimitive-plus prototype-of-class-instance");
  const p = { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(+o);
}
{
  const print = printer("toprimitive-plus prototype-is-instance");
  class C { [Symbol.toPrimitive] = function (hint) { return hint === "number" ? 3 : 4 }; }
  const o = Object.create(new C());
  print(+o);
}
{
  const print = printer("toprimitive-plus stored-after");
  const o = {};
  o[Symbol.toPrimitive] = function (hint) { return hint === "number" ? 3 : 4 };
  print(+o);
}
{
  const print = printer("toprimitive-plus stored-after-with-field");
  const o = { x: 1 };
  o[Symbol.toPrimitive] = function (hint) { return hint === "number" ? 3 : 4 };
  print(+o);
}
{
  const print = printer("toprimitive-plus stored-after-on-prototype");
  const p = {};
  p[Symbol.toPrimitive] = function (hint) { return hint === "number" ? 3 : 4 };
  const o = Object.create(p);
  print(+o);
}
{
  const print = printer("toprimitive-plus stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p[Symbol.toPrimitive] = function (hint) { return hint === "number" ? 3 : 4 };
  print(+o);
}
{
  const print = printer("toprimitive-plus stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o[Symbol.toPrimitive] = function (hint) { return hint === "number" ? 3 : 4 };
  print(+o);
}
{
  const print = printer("toprimitive-plus stored-on-class-prototype");
  class C { x = 1; }
  C.prototype[Symbol.toPrimitive] = function (hint) { return hint === "number" ? 3 : 4 };
  const o = new C();
  print(+o);
}
{
  const print = printer("toprimitive-plus constructor-function");
  function F() {}
  F.prototype[Symbol.toPrimitive] = function (hint) { return hint === "number" ? 3 : 4 };
  const o = new F();
  print(+o);
}
{
  const print = printer("toprimitive-plus constructor-function-prototype-object");
  function F() {}
  F.prototype = { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } };
  const o = new F();
  print(+o);
}
{
  const print = printer("toprimitive-plus constructor-function-this");
  function F() { this[Symbol.toPrimitive] = function (hint) { return hint === "number" ? 3 : 4 }; }
  const o = new F();
  print(+o);
}
{
  const print = printer("toprimitive-plus getter");
  const o = { get [Symbol.toPrimitive]() { return function (hint) { return hint === "number" ? 3 : 4 }; } };
  print(+o);
}
{
  const print = printer("toprimitive-plus defined");
  const o = {};
  Object.defineProperty(o, Symbol.toPrimitive, { value: function (hint) { return hint === "number" ? 3 : 4 } });
  print(+o);
}
{
  const print = printer("toprimitive-plus assigned");
  const o = Object.assign({}, { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } });
  print(+o);
}
{
  const print = printer("toprimitive-plus spread-copy");
  const o = { ...{ [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } } };
  print(+o);
}
{
  const print = printer("toprimitive-plus made-in-function");
  function make() { return { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } }; }
  const o = make();
  print(+o);
}
{
  const print = printer("toprimitive-plus made-in-function-twice");
  function make() { return { [Symbol.toPrimitive](hint) { return hint === "number" ? 3 : 4 } }; }
  make();
  const o = make();
  print(+o);
}
{
  const print = printer("toprimitive-plus literal-arrow");
  const o = { [Symbol.toPrimitive]: (hint) => { return hint === "number" ? 3 : 4 } };
  print(+o);
}
{
  const print = printer("toprimitive-plus class-field-arrow");
  class C { [Symbol.toPrimitive] = (hint) => { return hint === "number" ? 3 : 4 }; }
  const o = new C();
  print(+o);
}
{
  const print = printer("toprimitive-plus prototype-create-arrow");
  const p = { [Symbol.toPrimitive]: (hint) => { return hint === "number" ? 3 : 4 } };
  const o = Object.create(p);
  print(+o);
}
{
  const print = printer("toprimitive-key literal");
  const o = { [Symbol.toPrimitive](hint) { return hint } };
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key literal-function");
  const o = { [Symbol.toPrimitive]: function (hint) { return hint } };
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key literal-with-field");
  const o = { x: 1, [Symbol.toPrimitive](hint) { return hint } };
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key class-method");
  class C { [Symbol.toPrimitive](hint) { return hint } }
  const o = new C();
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key class-field");
  class C { [Symbol.toPrimitive] = function (hint) { return hint }; }
  const o = new C();
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key subclass");
  class B { [Symbol.toPrimitive](hint) { return hint } }
  class C extends B {}
  const o = new C();
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key class-static");
  class C { static [Symbol.toPrimitive](hint) { return hint } }
  const o = C;
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key prototype-create");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = Object.create(p);
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key prototype-literal");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { __proto__: p };
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key prototype-literal-with-field");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { __proto__: p, x: 1 };
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key prototype-set");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key prototype-set-with-field");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key prototype-reflect-set");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key prototype-proto-store");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key prototype-two-levels");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = Object.create(Object.create(p));
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key prototype-of-class-instance");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key prototype-is-instance");
  class C { [Symbol.toPrimitive] = function (hint) { return hint }; }
  const o = Object.create(new C());
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key stored-after");
  const o = {};
  o[Symbol.toPrimitive] = function (hint) { return hint };
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key stored-after-with-field");
  const o = { x: 1 };
  o[Symbol.toPrimitive] = function (hint) { return hint };
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key stored-after-on-prototype");
  const p = {};
  p[Symbol.toPrimitive] = function (hint) { return hint };
  const o = Object.create(p);
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p[Symbol.toPrimitive] = function (hint) { return hint };
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o[Symbol.toPrimitive] = function (hint) { return hint };
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key stored-on-class-prototype");
  class C { x = 1; }
  C.prototype[Symbol.toPrimitive] = function (hint) { return hint };
  const o = new C();
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key constructor-function");
  function F() {}
  F.prototype[Symbol.toPrimitive] = function (hint) { return hint };
  const o = new F();
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key constructor-function-prototype-object");
  function F() {}
  F.prototype = { [Symbol.toPrimitive](hint) { return hint } };
  const o = new F();
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key constructor-function-this");
  function F() { this[Symbol.toPrimitive] = function (hint) { return hint }; }
  const o = new F();
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key getter");
  const o = { get [Symbol.toPrimitive]() { return function (hint) { return hint }; } };
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key defined");
  const o = {};
  Object.defineProperty(o, Symbol.toPrimitive, { value: function (hint) { return hint } });
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key assigned");
  const o = Object.assign({}, { [Symbol.toPrimitive](hint) { return hint } });
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key spread-copy");
  const o = { ...{ [Symbol.toPrimitive](hint) { return hint } } };
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key made-in-function");
  function make() { return { [Symbol.toPrimitive](hint) { return hint } }; }
  const o = make();
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key made-in-function-twice");
  function make() { return { [Symbol.toPrimitive](hint) { return hint } }; }
  make();
  const o = make();
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key literal-arrow");
  const o = { [Symbol.toPrimitive]: (hint) => { return hint } };
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key class-field-arrow");
  class C { [Symbol.toPrimitive] = (hint) => { return hint }; }
  const o = new C();
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-key prototype-create-arrow");
  const p = { [Symbol.toPrimitive]: (hint) => { return hint } };
  const o = Object.create(p);
  print(({ string: 6 })[o]);
}
{
  const print = printer("toprimitive-equal literal");
  const o = { [Symbol.toPrimitive](hint) { return hint } };
  print(o == "default");
}
{
  const print = printer("toprimitive-equal literal-function");
  const o = { [Symbol.toPrimitive]: function (hint) { return hint } };
  print(o == "default");
}
{
  const print = printer("toprimitive-equal literal-with-field");
  const o = { x: 1, [Symbol.toPrimitive](hint) { return hint } };
  print(o == "default");
}
{
  const print = printer("toprimitive-equal class-method");
  class C { [Symbol.toPrimitive](hint) { return hint } }
  const o = new C();
  print(o == "default");
}
{
  const print = printer("toprimitive-equal class-field");
  class C { [Symbol.toPrimitive] = function (hint) { return hint }; }
  const o = new C();
  print(o == "default");
}
{
  const print = printer("toprimitive-equal subclass");
  class B { [Symbol.toPrimitive](hint) { return hint } }
  class C extends B {}
  const o = new C();
  print(o == "default");
}
{
  const print = printer("toprimitive-equal class-static");
  class C { static [Symbol.toPrimitive](hint) { return hint } }
  const o = C;
  print(o == "default");
}
{
  const print = printer("toprimitive-equal prototype-create");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = Object.create(p);
  print(o == "default");
}
{
  const print = printer("toprimitive-equal prototype-literal");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { __proto__: p };
  print(o == "default");
}
{
  const print = printer("toprimitive-equal prototype-literal-with-field");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { __proto__: p, x: 1 };
  print(o == "default");
}
{
  const print = printer("toprimitive-equal prototype-set");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(o == "default");
}
{
  const print = printer("toprimitive-equal prototype-set-with-field");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(o == "default");
}
{
  const print = printer("toprimitive-equal prototype-reflect-set");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(o == "default");
}
{
  const print = printer("toprimitive-equal prototype-proto-store");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(o == "default");
}
{
  const print = printer("toprimitive-equal prototype-two-levels");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  const o = Object.create(Object.create(p));
  print(o == "default");
}
{
  const print = printer("toprimitive-equal prototype-of-class-instance");
  const p = { [Symbol.toPrimitive](hint) { return hint } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(o == "default");
}
{
  const print = printer("toprimitive-equal prototype-is-instance");
  class C { [Symbol.toPrimitive] = function (hint) { return hint }; }
  const o = Object.create(new C());
  print(o == "default");
}
{
  const print = printer("toprimitive-equal stored-after");
  const o = {};
  o[Symbol.toPrimitive] = function (hint) { return hint };
  print(o == "default");
}
{
  const print = printer("toprimitive-equal stored-after-with-field");
  const o = { x: 1 };
  o[Symbol.toPrimitive] = function (hint) { return hint };
  print(o == "default");
}
{
  const print = printer("toprimitive-equal stored-after-on-prototype");
  const p = {};
  p[Symbol.toPrimitive] = function (hint) { return hint };
  const o = Object.create(p);
  print(o == "default");
}
{
  const print = printer("toprimitive-equal stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p[Symbol.toPrimitive] = function (hint) { return hint };
  print(o == "default");
}
{
  const print = printer("toprimitive-equal stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o[Symbol.toPrimitive] = function (hint) { return hint };
  print(o == "default");
}
{
  const print = printer("toprimitive-equal stored-on-class-prototype");
  class C { x = 1; }
  C.prototype[Symbol.toPrimitive] = function (hint) { return hint };
  const o = new C();
  print(o == "default");
}
{
  const print = printer("toprimitive-equal constructor-function");
  function F() {}
  F.prototype[Symbol.toPrimitive] = function (hint) { return hint };
  const o = new F();
  print(o == "default");
}
{
  const print = printer("toprimitive-equal constructor-function-prototype-object");
  function F() {}
  F.prototype = { [Symbol.toPrimitive](hint) { return hint } };
  const o = new F();
  print(o == "default");
}
{
  const print = printer("toprimitive-equal constructor-function-this");
  function F() { this[Symbol.toPrimitive] = function (hint) { return hint }; }
  const o = new F();
  print(o == "default");
}
{
  const print = printer("toprimitive-equal getter");
  const o = { get [Symbol.toPrimitive]() { return function (hint) { return hint }; } };
  print(o == "default");
}
{
  const print = printer("toprimitive-equal defined");
  const o = {};
  Object.defineProperty(o, Symbol.toPrimitive, { value: function (hint) { return hint } });
  print(o == "default");
}
{
  const print = printer("toprimitive-equal assigned");
  const o = Object.assign({}, { [Symbol.toPrimitive](hint) { return hint } });
  print(o == "default");
}
{
  const print = printer("toprimitive-equal spread-copy");
  const o = { ...{ [Symbol.toPrimitive](hint) { return hint } } };
  print(o == "default");
}
{
  const print = printer("toprimitive-equal made-in-function");
  function make() { return { [Symbol.toPrimitive](hint) { return hint } }; }
  const o = make();
  print(o == "default");
}
{
  const print = printer("toprimitive-equal made-in-function-twice");
  function make() { return { [Symbol.toPrimitive](hint) { return hint } }; }
  make();
  const o = make();
  print(o == "default");
}
{
  const print = printer("toprimitive-equal literal-arrow");
  const o = { [Symbol.toPrimitive]: (hint) => { return hint } };
  print(o == "default");
}
{
  const print = printer("toprimitive-equal class-field-arrow");
  class C { [Symbol.toPrimitive] = (hint) => { return hint }; }
  const o = new C();
  print(o == "default");
}
{
  const print = printer("toprimitive-equal prototype-create-arrow");
  const p = { [Symbol.toPrimitive]: (hint) => { return hint } };
  const o = Object.create(p);
  print(o == "default");
}

console.log(lines.join("\n"));

// GENERATED: printer B
// CHECK-LABEL: function {{*}}name="printer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_2]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_8]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_10]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_12]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_12]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
