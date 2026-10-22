// toString is run by templates, String(), concatenation, property keys and built-ins, wherever the object got it from.
const lines = [];
function printer(label) {
  return (...values) => {
    let text = label + ":";
    for (let i = 0; i < values.length; i++) text += " " + String(values[i]);
    lines.push(text);
  };
}

{
  const print = printer("tostring-template literal");
  const o = { toString() { return "label" } };
  print(`${o}`);
}
{
  const print = printer("tostring-template literal-function");
  const o = { toString: function () { return "label" } };
  print(`${o}`);
}
{
  const print = printer("tostring-template literal-with-field");
  const o = { x: 1, toString() { return "label" } };
  print(`${o}`);
}
{
  const print = printer("tostring-template class-method");
  class C { toString() { return "label" } }
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("tostring-template class-field");
  class C { toString = function () { return "label" }; }
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("tostring-template subclass");
  class B { toString() { return "label" } }
  class C extends B {}
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("tostring-template class-static");
  class C { static toString() { return "label" } }
  const o = C;
  print(`${o}`);
}
{
  const print = printer("tostring-template prototype-create");
  const p = { toString() { return "label" } };
  const o = Object.create(p);
  print(`${o}`);
}
{
  const print = printer("tostring-template prototype-literal");
  const p = { toString() { return "label" } };
  const o = { __proto__: p };
  print(`${o}`);
}
{
  const print = printer("tostring-template prototype-literal-with-field");
  const p = { toString() { return "label" } };
  const o = { __proto__: p, x: 1 };
  print(`${o}`);
}
{
  const print = printer("tostring-template prototype-set");
  const p = { toString() { return "label" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(`${o}`);
}
{
  const print = printer("tostring-template prototype-set-with-field");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(`${o}`);
}
{
  const print = printer("tostring-template prototype-reflect-set");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(`${o}`);
}
{
  const print = printer("tostring-template prototype-proto-store");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(`${o}`);
}
{
  const print = printer("tostring-template prototype-two-levels");
  const p = { toString() { return "label" } };
  const o = Object.create(Object.create(p));
  print(`${o}`);
}
{
  const print = printer("tostring-template prototype-of-class-instance");
  const p = { toString() { return "label" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("tostring-template prototype-is-instance");
  class C { toString = function () { return "label" }; }
  const o = Object.create(new C());
  print(`${o}`);
}
{
  const print = printer("tostring-template stored-after");
  const o = {};
  o.toString = function () { return "label" };
  print(`${o}`);
}
{
  const print = printer("tostring-template stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "label" };
  print(`${o}`);
}
{
  const print = printer("tostring-template stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "label" };
  const o = Object.create(p);
  print(`${o}`);
}
{
  const print = printer("tostring-template stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "label" };
  print(`${o}`);
}
{
  const print = printer("tostring-template stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "label" };
  print(`${o}`);
}
{
  const print = printer("tostring-template stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "label" };
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("tostring-template constructor-function");
  function F() {}
  F.prototype.toString = function () { return "label" };
  const o = new F();
  print(`${o}`);
}
{
  const print = printer("tostring-template constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "label" } };
  const o = new F();
  print(`${o}`);
}
{
  const print = printer("tostring-template constructor-function-this");
  function F() { this.toString = function () { return "label" }; }
  const o = new F();
  print(`${o}`);
}
{
  const print = printer("tostring-template getter");
  const o = { get toString() { return function () { return "label" }; } };
  print(`${o}`);
}
{
  const print = printer("tostring-template defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "label" } });
  print(`${o}`);
}
{
  const print = printer("tostring-template assigned");
  const o = Object.assign({}, { toString() { return "label" } });
  print(`${o}`);
}
{
  const print = printer("tostring-template spread-copy");
  const o = { ...{ toString() { return "label" } } };
  print(`${o}`);
}
{
  const print = printer("tostring-template made-in-function");
  function make() { return { toString() { return "label" } }; }
  const o = make();
  print(`${o}`);
}
{
  const print = printer("tostring-template made-in-function-twice");
  function make() { return { toString() { return "label" } }; }
  make();
  const o = make();
  print(`${o}`);
}
{
  const print = printer("tostring-template literal-arrow");
  const o = { toString: () => { return "label" } };
  print(`${o}`);
}
{
  const print = printer("tostring-template class-field-arrow");
  class C { toString = () => { return "label" }; }
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("tostring-template prototype-create-arrow");
  const p = { toString: () => { return "label" } };
  const o = Object.create(p);
  print(`${o}`);
}
{
  const print = printer("tostring-string literal");
  const o = { toString() { return "label" } };
  print(String(o));
}
{
  const print = printer("tostring-string literal-function");
  const o = { toString: function () { return "label" } };
  print(String(o));
}
{
  const print = printer("tostring-string literal-with-field");
  const o = { x: 1, toString() { return "label" } };
  print(String(o));
}
{
  const print = printer("tostring-string class-method");
  class C { toString() { return "label" } }
  const o = new C();
  print(String(o));
}
{
  const print = printer("tostring-string class-field");
  class C { toString = function () { return "label" }; }
  const o = new C();
  print(String(o));
}
{
  const print = printer("tostring-string subclass");
  class B { toString() { return "label" } }
  class C extends B {}
  const o = new C();
  print(String(o));
}
{
  const print = printer("tostring-string class-static");
  class C { static toString() { return "label" } }
  const o = C;
  print(String(o));
}
{
  const print = printer("tostring-string prototype-create");
  const p = { toString() { return "label" } };
  const o = Object.create(p);
  print(String(o));
}
{
  const print = printer("tostring-string prototype-literal");
  const p = { toString() { return "label" } };
  const o = { __proto__: p };
  print(String(o));
}
{
  const print = printer("tostring-string prototype-literal-with-field");
  const p = { toString() { return "label" } };
  const o = { __proto__: p, x: 1 };
  print(String(o));
}
{
  const print = printer("tostring-string prototype-set");
  const p = { toString() { return "label" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(String(o));
}
{
  const print = printer("tostring-string prototype-set-with-field");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(String(o));
}
{
  const print = printer("tostring-string prototype-reflect-set");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(String(o));
}
{
  const print = printer("tostring-string prototype-proto-store");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(String(o));
}
{
  const print = printer("tostring-string prototype-two-levels");
  const p = { toString() { return "label" } };
  const o = Object.create(Object.create(p));
  print(String(o));
}
{
  const print = printer("tostring-string prototype-of-class-instance");
  const p = { toString() { return "label" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(String(o));
}
{
  const print = printer("tostring-string prototype-is-instance");
  class C { toString = function () { return "label" }; }
  const o = Object.create(new C());
  print(String(o));
}
{
  const print = printer("tostring-string stored-after");
  const o = {};
  o.toString = function () { return "label" };
  print(String(o));
}
{
  const print = printer("tostring-string stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "label" };
  print(String(o));
}
{
  const print = printer("tostring-string stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "label" };
  const o = Object.create(p);
  print(String(o));
}
{
  const print = printer("tostring-string stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "label" };
  print(String(o));
}
{
  const print = printer("tostring-string stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "label" };
  print(String(o));
}
{
  const print = printer("tostring-string stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "label" };
  const o = new C();
  print(String(o));
}
{
  const print = printer("tostring-string constructor-function");
  function F() {}
  F.prototype.toString = function () { return "label" };
  const o = new F();
  print(String(o));
}
{
  const print = printer("tostring-string constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "label" } };
  const o = new F();
  print(String(o));
}
{
  const print = printer("tostring-string constructor-function-this");
  function F() { this.toString = function () { return "label" }; }
  const o = new F();
  print(String(o));
}
{
  const print = printer("tostring-string getter");
  const o = { get toString() { return function () { return "label" }; } };
  print(String(o));
}
{
  const print = printer("tostring-string defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "label" } });
  print(String(o));
}
{
  const print = printer("tostring-string assigned");
  const o = Object.assign({}, { toString() { return "label" } });
  print(String(o));
}
{
  const print = printer("tostring-string spread-copy");
  const o = { ...{ toString() { return "label" } } };
  print(String(o));
}
{
  const print = printer("tostring-string made-in-function");
  function make() { return { toString() { return "label" } }; }
  const o = make();
  print(String(o));
}
{
  const print = printer("tostring-string made-in-function-twice");
  function make() { return { toString() { return "label" } }; }
  make();
  const o = make();
  print(String(o));
}
{
  const print = printer("tostring-string literal-arrow");
  const o = { toString: () => { return "label" } };
  print(String(o));
}
{
  const print = printer("tostring-string class-field-arrow");
  class C { toString = () => { return "label" }; }
  const o = new C();
  print(String(o));
}
{
  const print = printer("tostring-string prototype-create-arrow");
  const p = { toString: () => { return "label" } };
  const o = Object.create(p);
  print(String(o));
}
{
  const print = printer("tostring-concat literal");
  const o = { toString() { return "label" } };
  print("" + o);
}
{
  const print = printer("tostring-concat literal-function");
  const o = { toString: function () { return "label" } };
  print("" + o);
}
{
  const print = printer("tostring-concat literal-with-field");
  const o = { x: 1, toString() { return "label" } };
  print("" + o);
}
{
  const print = printer("tostring-concat class-method");
  class C { toString() { return "label" } }
  const o = new C();
  print("" + o);
}
{
  const print = printer("tostring-concat class-field");
  class C { toString = function () { return "label" }; }
  const o = new C();
  print("" + o);
}
{
  const print = printer("tostring-concat subclass");
  class B { toString() { return "label" } }
  class C extends B {}
  const o = new C();
  print("" + o);
}
{
  const print = printer("tostring-concat class-static");
  class C { static toString() { return "label" } }
  const o = C;
  print("" + o);
}
{
  const print = printer("tostring-concat prototype-create");
  const p = { toString() { return "label" } };
  const o = Object.create(p);
  print("" + o);
}
{
  const print = printer("tostring-concat prototype-literal");
  const p = { toString() { return "label" } };
  const o = { __proto__: p };
  print("" + o);
}
{
  const print = printer("tostring-concat prototype-literal-with-field");
  const p = { toString() { return "label" } };
  const o = { __proto__: p, x: 1 };
  print("" + o);
}
{
  const print = printer("tostring-concat prototype-set");
  const p = { toString() { return "label" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print("" + o);
}
{
  const print = printer("tostring-concat prototype-set-with-field");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print("" + o);
}
{
  const print = printer("tostring-concat prototype-reflect-set");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print("" + o);
}
{
  const print = printer("tostring-concat prototype-proto-store");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  o.__proto__ = p;
  print("" + o);
}
{
  const print = printer("tostring-concat prototype-two-levels");
  const p = { toString() { return "label" } };
  const o = Object.create(Object.create(p));
  print("" + o);
}
{
  const print = printer("tostring-concat prototype-of-class-instance");
  const p = { toString() { return "label" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print("" + o);
}
{
  const print = printer("tostring-concat prototype-is-instance");
  class C { toString = function () { return "label" }; }
  const o = Object.create(new C());
  print("" + o);
}
{
  const print = printer("tostring-concat stored-after");
  const o = {};
  o.toString = function () { return "label" };
  print("" + o);
}
{
  const print = printer("tostring-concat stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "label" };
  print("" + o);
}
{
  const print = printer("tostring-concat stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "label" };
  const o = Object.create(p);
  print("" + o);
}
{
  const print = printer("tostring-concat stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "label" };
  print("" + o);
}
{
  const print = printer("tostring-concat stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "label" };
  print("" + o);
}
{
  const print = printer("tostring-concat stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "label" };
  const o = new C();
  print("" + o);
}
{
  const print = printer("tostring-concat constructor-function");
  function F() {}
  F.prototype.toString = function () { return "label" };
  const o = new F();
  print("" + o);
}
{
  const print = printer("tostring-concat constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "label" } };
  const o = new F();
  print("" + o);
}
{
  const print = printer("tostring-concat constructor-function-this");
  function F() { this.toString = function () { return "label" }; }
  const o = new F();
  print("" + o);
}
{
  const print = printer("tostring-concat getter");
  const o = { get toString() { return function () { return "label" }; } };
  print("" + o);
}
{
  const print = printer("tostring-concat defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "label" } });
  print("" + o);
}
{
  const print = printer("tostring-concat assigned");
  const o = Object.assign({}, { toString() { return "label" } });
  print("" + o);
}
{
  const print = printer("tostring-concat spread-copy");
  const o = { ...{ toString() { return "label" } } };
  print("" + o);
}
{
  const print = printer("tostring-concat made-in-function");
  function make() { return { toString() { return "label" } }; }
  const o = make();
  print("" + o);
}
{
  const print = printer("tostring-concat made-in-function-twice");
  function make() { return { toString() { return "label" } }; }
  make();
  const o = make();
  print("" + o);
}
{
  const print = printer("tostring-concat literal-arrow");
  const o = { toString: () => { return "label" } };
  print("" + o);
}
{
  const print = printer("tostring-concat class-field-arrow");
  class C { toString = () => { return "label" }; }
  const o = new C();
  print("" + o);
}
{
  const print = printer("tostring-concat prototype-create-arrow");
  const p = { toString: () => { return "label" } };
  const o = Object.create(p);
  print("" + o);
}
{
  const print = printer("tostring-key literal");
  const o = { toString() { return "label" } };
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key literal-function");
  const o = { toString: function () { return "label" } };
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key literal-with-field");
  const o = { x: 1, toString() { return "label" } };
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key class-method");
  class C { toString() { return "label" } }
  const o = new C();
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key class-field");
  class C { toString = function () { return "label" }; }
  const o = new C();
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key subclass");
  class B { toString() { return "label" } }
  class C extends B {}
  const o = new C();
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key class-static");
  class C { static toString() { return "label" } }
  const o = C;
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key prototype-create");
  const p = { toString() { return "label" } };
  const o = Object.create(p);
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key prototype-literal");
  const p = { toString() { return "label" } };
  const o = { __proto__: p };
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key prototype-literal-with-field");
  const p = { toString() { return "label" } };
  const o = { __proto__: p, x: 1 };
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key prototype-set");
  const p = { toString() { return "label" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key prototype-set-with-field");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key prototype-reflect-set");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key prototype-proto-store");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  o.__proto__ = p;
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key prototype-two-levels");
  const p = { toString() { return "label" } };
  const o = Object.create(Object.create(p));
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key prototype-of-class-instance");
  const p = { toString() { return "label" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key prototype-is-instance");
  class C { toString = function () { return "label" }; }
  const o = Object.create(new C());
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key stored-after");
  const o = {};
  o.toString = function () { return "label" };
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "label" };
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "label" };
  const o = Object.create(p);
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "label" };
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "label" };
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "label" };
  const o = new C();
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key constructor-function");
  function F() {}
  F.prototype.toString = function () { return "label" };
  const o = new F();
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "label" } };
  const o = new F();
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key constructor-function-this");
  function F() { this.toString = function () { return "label" }; }
  const o = new F();
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key getter");
  const o = { get toString() { return function () { return "label" }; } };
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "label" } });
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key assigned");
  const o = Object.assign({}, { toString() { return "label" } });
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key spread-copy");
  const o = { ...{ toString() { return "label" } } };
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key made-in-function");
  function make() { return { toString() { return "label" } }; }
  const o = make();
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key made-in-function-twice");
  function make() { return { toString() { return "label" } }; }
  make();
  const o = make();
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key literal-arrow");
  const o = { toString: () => { return "label" } };
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key class-field-arrow");
  class C { toString = () => { return "label" }; }
  const o = new C();
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key prototype-create-arrow");
  const p = { toString: () => { return "label" } };
  const o = Object.create(p);
  const t = { label: 1 }; print(t[o]);
}
{
  const print = printer("tostring-key-store literal");
  const o = { toString() { return "label" } };
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store literal-function");
  const o = { toString: function () { return "label" } };
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store literal-with-field");
  const o = { x: 1, toString() { return "label" } };
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store class-method");
  class C { toString() { return "label" } }
  const o = new C();
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store class-field");
  class C { toString = function () { return "label" }; }
  const o = new C();
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store subclass");
  class B { toString() { return "label" } }
  class C extends B {}
  const o = new C();
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store class-static");
  class C { static toString() { return "label" } }
  const o = C;
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store prototype-create");
  const p = { toString() { return "label" } };
  const o = Object.create(p);
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store prototype-literal");
  const p = { toString() { return "label" } };
  const o = { __proto__: p };
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store prototype-literal-with-field");
  const p = { toString() { return "label" } };
  const o = { __proto__: p, x: 1 };
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store prototype-set");
  const p = { toString() { return "label" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store prototype-set-with-field");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store prototype-reflect-set");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store prototype-proto-store");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  o.__proto__ = p;
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store prototype-two-levels");
  const p = { toString() { return "label" } };
  const o = Object.create(Object.create(p));
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store prototype-of-class-instance");
  const p = { toString() { return "label" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store prototype-is-instance");
  class C { toString = function () { return "label" }; }
  const o = Object.create(new C());
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store stored-after");
  const o = {};
  o.toString = function () { return "label" };
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "label" };
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "label" };
  const o = Object.create(p);
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "label" };
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "label" };
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "label" };
  const o = new C();
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store constructor-function");
  function F() {}
  F.prototype.toString = function () { return "label" };
  const o = new F();
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "label" } };
  const o = new F();
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store constructor-function-this");
  function F() { this.toString = function () { return "label" }; }
  const o = new F();
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store getter");
  const o = { get toString() { return function () { return "label" }; } };
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "label" } });
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store assigned");
  const o = Object.assign({}, { toString() { return "label" } });
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store spread-copy");
  const o = { ...{ toString() { return "label" } } };
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store made-in-function");
  function make() { return { toString() { return "label" } }; }
  const o = make();
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store made-in-function-twice");
  function make() { return { toString() { return "label" } }; }
  make();
  const o = make();
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store literal-arrow");
  const o = { toString: () => { return "label" } };
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store class-field-arrow");
  class C { toString = () => { return "label" }; }
  const o = new C();
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-key-store prototype-create-arrow");
  const p = { toString: () => { return "label" } };
  const o = Object.create(p);
  const t = {}; t[o] = 3; print(t.label);
}
{
  const print = printer("tostring-in literal");
  const o = { toString() { return "label" } };
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in literal-function");
  const o = { toString: function () { return "label" } };
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in literal-with-field");
  const o = { x: 1, toString() { return "label" } };
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in class-method");
  class C { toString() { return "label" } }
  const o = new C();
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in class-field");
  class C { toString = function () { return "label" }; }
  const o = new C();
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in subclass");
  class B { toString() { return "label" } }
  class C extends B {}
  const o = new C();
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in class-static");
  class C { static toString() { return "label" } }
  const o = C;
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in prototype-create");
  const p = { toString() { return "label" } };
  const o = Object.create(p);
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in prototype-literal");
  const p = { toString() { return "label" } };
  const o = { __proto__: p };
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in prototype-literal-with-field");
  const p = { toString() { return "label" } };
  const o = { __proto__: p, x: 1 };
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in prototype-set");
  const p = { toString() { return "label" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in prototype-set-with-field");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in prototype-reflect-set");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in prototype-proto-store");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in prototype-two-levels");
  const p = { toString() { return "label" } };
  const o = Object.create(Object.create(p));
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in prototype-of-class-instance");
  const p = { toString() { return "label" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in prototype-is-instance");
  class C { toString = function () { return "label" }; }
  const o = Object.create(new C());
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in stored-after");
  const o = {};
  o.toString = function () { return "label" };
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "label" };
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "label" };
  const o = Object.create(p);
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "label" };
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "label" };
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "label" };
  const o = new C();
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in constructor-function");
  function F() {}
  F.prototype.toString = function () { return "label" };
  const o = new F();
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "label" } };
  const o = new F();
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in constructor-function-this");
  function F() { this.toString = function () { return "label" }; }
  const o = new F();
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in getter");
  const o = { get toString() { return function () { return "label" }; } };
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "label" } });
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in assigned");
  const o = Object.assign({}, { toString() { return "label" } });
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in spread-copy");
  const o = { ...{ toString() { return "label" } } };
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in made-in-function");
  function make() { return { toString() { return "label" } }; }
  const o = make();
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in made-in-function-twice");
  function make() { return { toString() { return "label" } }; }
  make();
  const o = make();
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in literal-arrow");
  const o = { toString: () => { return "label" } };
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in class-field-arrow");
  class C { toString = () => { return "label" }; }
  const o = new C();
  print(o in { label: 1 });
}
{
  const print = printer("tostring-in prototype-create-arrow");
  const p = { toString: () => { return "label" } };
  const o = Object.create(p);
  print(o in { label: 1 });
}
{
  const print = printer("tostring-native literal");
  const o = { toString() { return "label" } };
  print(o);
}
{
  const print = printer("tostring-native literal-function");
  const o = { toString: function () { return "label" } };
  print(o);
}
{
  const print = printer("tostring-native literal-with-field");
  const o = { x: 1, toString() { return "label" } };
  print(o);
}
{
  const print = printer("tostring-native class-method");
  class C { toString() { return "label" } }
  const o = new C();
  print(o);
}
{
  const print = printer("tostring-native class-field");
  class C { toString = function () { return "label" }; }
  const o = new C();
  print(o);
}
{
  const print = printer("tostring-native subclass");
  class B { toString() { return "label" } }
  class C extends B {}
  const o = new C();
  print(o);
}
{
  const print = printer("tostring-native class-static");
  class C { static toString() { return "label" } }
  const o = C;
  print(o);
}
{
  const print = printer("tostring-native prototype-create");
  const p = { toString() { return "label" } };
  const o = Object.create(p);
  print(o);
}
{
  const print = printer("tostring-native prototype-literal");
  const p = { toString() { return "label" } };
  const o = { __proto__: p };
  print(o);
}
{
  const print = printer("tostring-native prototype-literal-with-field");
  const p = { toString() { return "label" } };
  const o = { __proto__: p, x: 1 };
  print(o);
}
{
  const print = printer("tostring-native prototype-set");
  const p = { toString() { return "label" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(o);
}
{
  const print = printer("tostring-native prototype-set-with-field");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(o);
}
{
  const print = printer("tostring-native prototype-reflect-set");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(o);
}
{
  const print = printer("tostring-native prototype-proto-store");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(o);
}
{
  const print = printer("tostring-native prototype-two-levels");
  const p = { toString() { return "label" } };
  const o = Object.create(Object.create(p));
  print(o);
}
{
  const print = printer("tostring-native prototype-of-class-instance");
  const p = { toString() { return "label" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(o);
}
{
  const print = printer("tostring-native prototype-is-instance");
  class C { toString = function () { return "label" }; }
  const o = Object.create(new C());
  print(o);
}
{
  const print = printer("tostring-native stored-after");
  const o = {};
  o.toString = function () { return "label" };
  print(o);
}
{
  const print = printer("tostring-native stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "label" };
  print(o);
}
{
  const print = printer("tostring-native stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "label" };
  const o = Object.create(p);
  print(o);
}
{
  const print = printer("tostring-native stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "label" };
  print(o);
}
{
  const print = printer("tostring-native stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "label" };
  print(o);
}
{
  const print = printer("tostring-native stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "label" };
  const o = new C();
  print(o);
}
{
  const print = printer("tostring-native constructor-function");
  function F() {}
  F.prototype.toString = function () { return "label" };
  const o = new F();
  print(o);
}
{
  const print = printer("tostring-native constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "label" } };
  const o = new F();
  print(o);
}
{
  const print = printer("tostring-native constructor-function-this");
  function F() { this.toString = function () { return "label" }; }
  const o = new F();
  print(o);
}
{
  const print = printer("tostring-native getter");
  const o = { get toString() { return function () { return "label" }; } };
  print(o);
}
{
  const print = printer("tostring-native defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "label" } });
  print(o);
}
{
  const print = printer("tostring-native assigned");
  const o = Object.assign({}, { toString() { return "label" } });
  print(o);
}
{
  const print = printer("tostring-native spread-copy");
  const o = { ...{ toString() { return "label" } } };
  print(o);
}
{
  const print = printer("tostring-native made-in-function");
  function make() { return { toString() { return "label" } }; }
  const o = make();
  print(o);
}
{
  const print = printer("tostring-native made-in-function-twice");
  function make() { return { toString() { return "label" } }; }
  make();
  const o = make();
  print(o);
}
{
  const print = printer("tostring-native literal-arrow");
  const o = { toString: () => { return "label" } };
  print(o);
}
{
  const print = printer("tostring-native class-field-arrow");
  class C { toString = () => { return "label" }; }
  const o = new C();
  print(o);
}
{
  const print = printer("tostring-native prototype-create-arrow");
  const p = { toString: () => { return "label" } };
  const o = Object.create(p);
  print(o);
}
{
  const print = printer("tostring-parseint literal");
  const o = { toString() { return "42" } };
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint literal-function");
  const o = { toString: function () { return "42" } };
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint literal-with-field");
  const o = { x: 1, toString() { return "42" } };
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint class-method");
  class C { toString() { return "42" } }
  const o = new C();
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint class-field");
  class C { toString = function () { return "42" }; }
  const o = new C();
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint subclass");
  class B { toString() { return "42" } }
  class C extends B {}
  const o = new C();
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint class-static");
  class C { static toString() { return "42" } }
  const o = C;
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint prototype-create");
  const p = { toString() { return "42" } };
  const o = Object.create(p);
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint prototype-literal");
  const p = { toString() { return "42" } };
  const o = { __proto__: p };
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint prototype-literal-with-field");
  const p = { toString() { return "42" } };
  const o = { __proto__: p, x: 1 };
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint prototype-set");
  const p = { toString() { return "42" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint prototype-set-with-field");
  const p = { toString() { return "42" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint prototype-reflect-set");
  const p = { toString() { return "42" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint prototype-proto-store");
  const p = { toString() { return "42" } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint prototype-two-levels");
  const p = { toString() { return "42" } };
  const o = Object.create(Object.create(p));
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint prototype-of-class-instance");
  const p = { toString() { return "42" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint prototype-is-instance");
  class C { toString = function () { return "42" }; }
  const o = Object.create(new C());
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint stored-after");
  const o = {};
  o.toString = function () { return "42" };
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "42" };
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "42" };
  const o = Object.create(p);
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "42" };
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "42" };
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "42" };
  const o = new C();
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint constructor-function");
  function F() {}
  F.prototype.toString = function () { return "42" };
  const o = new F();
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "42" } };
  const o = new F();
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint constructor-function-this");
  function F() { this.toString = function () { return "42" }; }
  const o = new F();
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint getter");
  const o = { get toString() { return function () { return "42" }; } };
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "42" } });
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint assigned");
  const o = Object.assign({}, { toString() { return "42" } });
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint spread-copy");
  const o = { ...{ toString() { return "42" } } };
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint made-in-function");
  function make() { return { toString() { return "42" } }; }
  const o = make();
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint made-in-function-twice");
  function make() { return { toString() { return "42" } }; }
  make();
  const o = make();
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint literal-arrow");
  const o = { toString: () => { return "42" } };
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint class-field-arrow");
  class C { toString = () => { return "42" }; }
  const o = new C();
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-parseint prototype-create-arrow");
  const p = { toString: () => { return "42" } };
  const o = Object.create(p);
  print(parseInt(o), parseFloat(o));
}
{
  const print = printer("tostring-error literal");
  const o = { toString() { return "label" } };
  print(new Error(o).message);
}
{
  const print = printer("tostring-error literal-function");
  const o = { toString: function () { return "label" } };
  print(new Error(o).message);
}
{
  const print = printer("tostring-error literal-with-field");
  const o = { x: 1, toString() { return "label" } };
  print(new Error(o).message);
}
{
  const print = printer("tostring-error class-method");
  class C { toString() { return "label" } }
  const o = new C();
  print(new Error(o).message);
}
{
  const print = printer("tostring-error class-field");
  class C { toString = function () { return "label" }; }
  const o = new C();
  print(new Error(o).message);
}
{
  const print = printer("tostring-error subclass");
  class B { toString() { return "label" } }
  class C extends B {}
  const o = new C();
  print(new Error(o).message);
}
{
  const print = printer("tostring-error class-static");
  class C { static toString() { return "label" } }
  const o = C;
  print(new Error(o).message);
}
{
  const print = printer("tostring-error prototype-create");
  const p = { toString() { return "label" } };
  const o = Object.create(p);
  print(new Error(o).message);
}
{
  const print = printer("tostring-error prototype-literal");
  const p = { toString() { return "label" } };
  const o = { __proto__: p };
  print(new Error(o).message);
}
{
  const print = printer("tostring-error prototype-literal-with-field");
  const p = { toString() { return "label" } };
  const o = { __proto__: p, x: 1 };
  print(new Error(o).message);
}
{
  const print = printer("tostring-error prototype-set");
  const p = { toString() { return "label" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(new Error(o).message);
}
{
  const print = printer("tostring-error prototype-set-with-field");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(new Error(o).message);
}
{
  const print = printer("tostring-error prototype-reflect-set");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(new Error(o).message);
}
{
  const print = printer("tostring-error prototype-proto-store");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(new Error(o).message);
}
{
  const print = printer("tostring-error prototype-two-levels");
  const p = { toString() { return "label" } };
  const o = Object.create(Object.create(p));
  print(new Error(o).message);
}
{
  const print = printer("tostring-error prototype-of-class-instance");
  const p = { toString() { return "label" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(new Error(o).message);
}
{
  const print = printer("tostring-error prototype-is-instance");
  class C { toString = function () { return "label" }; }
  const o = Object.create(new C());
  print(new Error(o).message);
}
{
  const print = printer("tostring-error stored-after");
  const o = {};
  o.toString = function () { return "label" };
  print(new Error(o).message);
}
{
  const print = printer("tostring-error stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "label" };
  print(new Error(o).message);
}
{
  const print = printer("tostring-error stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "label" };
  const o = Object.create(p);
  print(new Error(o).message);
}
{
  const print = printer("tostring-error stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "label" };
  print(new Error(o).message);
}
{
  const print = printer("tostring-error stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "label" };
  print(new Error(o).message);
}
{
  const print = printer("tostring-error stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "label" };
  const o = new C();
  print(new Error(o).message);
}
{
  const print = printer("tostring-error constructor-function");
  function F() {}
  F.prototype.toString = function () { return "label" };
  const o = new F();
  print(new Error(o).message);
}
{
  const print = printer("tostring-error constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "label" } };
  const o = new F();
  print(new Error(o).message);
}
{
  const print = printer("tostring-error constructor-function-this");
  function F() { this.toString = function () { return "label" }; }
  const o = new F();
  print(new Error(o).message);
}
{
  const print = printer("tostring-error getter");
  const o = { get toString() { return function () { return "label" }; } };
  print(new Error(o).message);
}
{
  const print = printer("tostring-error defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "label" } });
  print(new Error(o).message);
}
{
  const print = printer("tostring-error assigned");
  const o = Object.assign({}, { toString() { return "label" } });
  print(new Error(o).message);
}
{
  const print = printer("tostring-error spread-copy");
  const o = { ...{ toString() { return "label" } } };
  print(new Error(o).message);
}
{
  const print = printer("tostring-error made-in-function");
  function make() { return { toString() { return "label" } }; }
  const o = make();
  print(new Error(o).message);
}
{
  const print = printer("tostring-error made-in-function-twice");
  function make() { return { toString() { return "label" } }; }
  make();
  const o = make();
  print(new Error(o).message);
}
{
  const print = printer("tostring-error literal-arrow");
  const o = { toString: () => { return "label" } };
  print(new Error(o).message);
}
{
  const print = printer("tostring-error class-field-arrow");
  class C { toString = () => { return "label" }; }
  const o = new C();
  print(new Error(o).message);
}
{
  const print = printer("tostring-error prototype-create-arrow");
  const p = { toString: () => { return "label" } };
  const o = Object.create(p);
  print(new Error(o).message);
}
{
  const print = printer("tostring-indexof literal");
  const o = { toString() { return "label" } };
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof literal-function");
  const o = { toString: function () { return "label" } };
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof literal-with-field");
  const o = { x: 1, toString() { return "label" } };
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof class-method");
  class C { toString() { return "label" } }
  const o = new C();
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof class-field");
  class C { toString = function () { return "label" }; }
  const o = new C();
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof subclass");
  class B { toString() { return "label" } }
  class C extends B {}
  const o = new C();
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof class-static");
  class C { static toString() { return "label" } }
  const o = C;
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof prototype-create");
  const p = { toString() { return "label" } };
  const o = Object.create(p);
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof prototype-literal");
  const p = { toString() { return "label" } };
  const o = { __proto__: p };
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof prototype-literal-with-field");
  const p = { toString() { return "label" } };
  const o = { __proto__: p, x: 1 };
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof prototype-set");
  const p = { toString() { return "label" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof prototype-set-with-field");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof prototype-reflect-set");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof prototype-proto-store");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  o.__proto__ = p;
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof prototype-two-levels");
  const p = { toString() { return "label" } };
  const o = Object.create(Object.create(p));
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof prototype-of-class-instance");
  const p = { toString() { return "label" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof prototype-is-instance");
  class C { toString = function () { return "label" }; }
  const o = Object.create(new C());
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof stored-after");
  const o = {};
  o.toString = function () { return "label" };
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "label" };
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "label" };
  const o = Object.create(p);
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "label" };
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "label" };
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "label" };
  const o = new C();
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof constructor-function");
  function F() {}
  F.prototype.toString = function () { return "label" };
  const o = new F();
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "label" } };
  const o = new F();
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof constructor-function-this");
  function F() { this.toString = function () { return "label" }; }
  const o = new F();
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof getter");
  const o = { get toString() { return function () { return "label" }; } };
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "label" } });
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof assigned");
  const o = Object.assign({}, { toString() { return "label" } });
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof spread-copy");
  const o = { ...{ toString() { return "label" } } };
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof made-in-function");
  function make() { return { toString() { return "label" } }; }
  const o = make();
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof made-in-function-twice");
  function make() { return { toString() { return "label" } }; }
  make();
  const o = make();
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof literal-arrow");
  const o = { toString: () => { return "label" } };
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof class-field-arrow");
  class C { toString = () => { return "label" }; }
  const o = new C();
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-indexof prototype-create-arrow");
  const p = { toString: () => { return "label" } };
  const o = Object.create(p);
  print("a label".indexOf(o));
}
{
  const print = printer("tostring-number literal");
  const o = { toString() { return "42" } };
  print(+o, o * 1);
}
{
  const print = printer("tostring-number literal-function");
  const o = { toString: function () { return "42" } };
  print(+o, o * 1);
}
{
  const print = printer("tostring-number literal-with-field");
  const o = { x: 1, toString() { return "42" } };
  print(+o, o * 1);
}
{
  const print = printer("tostring-number class-method");
  class C { toString() { return "42" } }
  const o = new C();
  print(+o, o * 1);
}
{
  const print = printer("tostring-number class-field");
  class C { toString = function () { return "42" }; }
  const o = new C();
  print(+o, o * 1);
}
{
  const print = printer("tostring-number subclass");
  class B { toString() { return "42" } }
  class C extends B {}
  const o = new C();
  print(+o, o * 1);
}
{
  const print = printer("tostring-number class-static");
  class C { static toString() { return "42" } }
  const o = C;
  print(+o, o * 1);
}
{
  const print = printer("tostring-number prototype-create");
  const p = { toString() { return "42" } };
  const o = Object.create(p);
  print(+o, o * 1);
}
{
  const print = printer("tostring-number prototype-literal");
  const p = { toString() { return "42" } };
  const o = { __proto__: p };
  print(+o, o * 1);
}
{
  const print = printer("tostring-number prototype-literal-with-field");
  const p = { toString() { return "42" } };
  const o = { __proto__: p, x: 1 };
  print(+o, o * 1);
}
{
  const print = printer("tostring-number prototype-set");
  const p = { toString() { return "42" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(+o, o * 1);
}
{
  const print = printer("tostring-number prototype-set-with-field");
  const p = { toString() { return "42" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(+o, o * 1);
}
{
  const print = printer("tostring-number prototype-reflect-set");
  const p = { toString() { return "42" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(+o, o * 1);
}
{
  const print = printer("tostring-number prototype-proto-store");
  const p = { toString() { return "42" } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(+o, o * 1);
}
{
  const print = printer("tostring-number prototype-two-levels");
  const p = { toString() { return "42" } };
  const o = Object.create(Object.create(p));
  print(+o, o * 1);
}
{
  const print = printer("tostring-number prototype-of-class-instance");
  const p = { toString() { return "42" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(+o, o * 1);
}
{
  const print = printer("tostring-number prototype-is-instance");
  class C { toString = function () { return "42" }; }
  const o = Object.create(new C());
  print(+o, o * 1);
}
{
  const print = printer("tostring-number stored-after");
  const o = {};
  o.toString = function () { return "42" };
  print(+o, o * 1);
}
{
  const print = printer("tostring-number stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "42" };
  print(+o, o * 1);
}
{
  const print = printer("tostring-number stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "42" };
  const o = Object.create(p);
  print(+o, o * 1);
}
{
  const print = printer("tostring-number stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "42" };
  print(+o, o * 1);
}
{
  const print = printer("tostring-number stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "42" };
  print(+o, o * 1);
}
{
  const print = printer("tostring-number stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "42" };
  const o = new C();
  print(+o, o * 1);
}
{
  const print = printer("tostring-number constructor-function");
  function F() {}
  F.prototype.toString = function () { return "42" };
  const o = new F();
  print(+o, o * 1);
}
{
  const print = printer("tostring-number constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "42" } };
  const o = new F();
  print(+o, o * 1);
}
{
  const print = printer("tostring-number constructor-function-this");
  function F() { this.toString = function () { return "42" }; }
  const o = new F();
  print(+o, o * 1);
}
{
  const print = printer("tostring-number getter");
  const o = { get toString() { return function () { return "42" }; } };
  print(+o, o * 1);
}
{
  const print = printer("tostring-number defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "42" } });
  print(+o, o * 1);
}
{
  const print = printer("tostring-number assigned");
  const o = Object.assign({}, { toString() { return "42" } });
  print(+o, o * 1);
}
{
  const print = printer("tostring-number spread-copy");
  const o = { ...{ toString() { return "42" } } };
  print(+o, o * 1);
}
{
  const print = printer("tostring-number made-in-function");
  function make() { return { toString() { return "42" } }; }
  const o = make();
  print(+o, o * 1);
}
{
  const print = printer("tostring-number made-in-function-twice");
  function make() { return { toString() { return "42" } }; }
  make();
  const o = make();
  print(+o, o * 1);
}
{
  const print = printer("tostring-number literal-arrow");
  const o = { toString: () => { return "42" } };
  print(+o, o * 1);
}
{
  const print = printer("tostring-number class-field-arrow");
  class C { toString = () => { return "42" }; }
  const o = new C();
  print(+o, o * 1);
}
{
  const print = printer("tostring-number prototype-create-arrow");
  const p = { toString: () => { return "42" } };
  const o = Object.create(p);
  print(+o, o * 1);
}
{
  const print = printer("tostring-symbol literal");
  const o = { toString() { return "label" } };
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol literal-function");
  const o = { toString: function () { return "label" } };
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol literal-with-field");
  const o = { x: 1, toString() { return "label" } };
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol class-method");
  class C { toString() { return "label" } }
  const o = new C();
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol class-field");
  class C { toString = function () { return "label" }; }
  const o = new C();
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol subclass");
  class B { toString() { return "label" } }
  class C extends B {}
  const o = new C();
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol class-static");
  class C { static toString() { return "label" } }
  const o = C;
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol prototype-create");
  const p = { toString() { return "label" } };
  const o = Object.create(p);
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol prototype-literal");
  const p = { toString() { return "label" } };
  const o = { __proto__: p };
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol prototype-literal-with-field");
  const p = { toString() { return "label" } };
  const o = { __proto__: p, x: 1 };
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol prototype-set");
  const p = { toString() { return "label" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol prototype-set-with-field");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol prototype-reflect-set");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol prototype-proto-store");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol prototype-two-levels");
  const p = { toString() { return "label" } };
  const o = Object.create(Object.create(p));
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol prototype-of-class-instance");
  const p = { toString() { return "label" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol prototype-is-instance");
  class C { toString = function () { return "label" }; }
  const o = Object.create(new C());
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol stored-after");
  const o = {};
  o.toString = function () { return "label" };
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "label" };
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "label" };
  const o = Object.create(p);
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "label" };
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "label" };
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "label" };
  const o = new C();
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol constructor-function");
  function F() {}
  F.prototype.toString = function () { return "label" };
  const o = new F();
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "label" } };
  const o = new F();
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol constructor-function-this");
  function F() { this.toString = function () { return "label" }; }
  const o = new F();
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol getter");
  const o = { get toString() { return function () { return "label" }; } };
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "label" } });
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol assigned");
  const o = Object.assign({}, { toString() { return "label" } });
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol spread-copy");
  const o = { ...{ toString() { return "label" } } };
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol made-in-function");
  function make() { return { toString() { return "label" } }; }
  const o = make();
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol made-in-function-twice");
  function make() { return { toString() { return "label" } }; }
  make();
  const o = make();
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol literal-arrow");
  const o = { toString: () => { return "label" } };
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol class-field-arrow");
  class C { toString = () => { return "label" }; }
  const o = new C();
  print(Symbol(o).description);
}
{
  const print = printer("tostring-symbol prototype-create-arrow");
  const p = { toString: () => { return "label" } };
  const o = Object.create(p);
  print(Symbol(o).description);
}
{
  const print = printer("tostring-computed-literal literal");
  const o = { toString() { return "label" } };
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal literal-function");
  const o = { toString: function () { return "label" } };
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal literal-with-field");
  const o = { x: 1, toString() { return "label" } };
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal class-method");
  class C { toString() { return "label" } }
  const o = new C();
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal class-field");
  class C { toString = function () { return "label" }; }
  const o = new C();
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal subclass");
  class B { toString() { return "label" } }
  class C extends B {}
  const o = new C();
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal class-static");
  class C { static toString() { return "label" } }
  const o = C;
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal prototype-create");
  const p = { toString() { return "label" } };
  const o = Object.create(p);
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal prototype-literal");
  const p = { toString() { return "label" } };
  const o = { __proto__: p };
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal prototype-literal-with-field");
  const p = { toString() { return "label" } };
  const o = { __proto__: p, x: 1 };
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal prototype-set");
  const p = { toString() { return "label" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal prototype-set-with-field");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal prototype-reflect-set");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal prototype-proto-store");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  o.__proto__ = p;
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal prototype-two-levels");
  const p = { toString() { return "label" } };
  const o = Object.create(Object.create(p));
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal prototype-of-class-instance");
  const p = { toString() { return "label" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal prototype-is-instance");
  class C { toString = function () { return "label" }; }
  const o = Object.create(new C());
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal stored-after");
  const o = {};
  o.toString = function () { return "label" };
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "label" };
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "label" };
  const o = Object.create(p);
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "label" };
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "label" };
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "label" };
  const o = new C();
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal constructor-function");
  function F() {}
  F.prototype.toString = function () { return "label" };
  const o = new F();
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "label" } };
  const o = new F();
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal constructor-function-this");
  function F() { this.toString = function () { return "label" }; }
  const o = new F();
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal getter");
  const o = { get toString() { return function () { return "label" }; } };
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "label" } });
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal assigned");
  const o = Object.assign({}, { toString() { return "label" } });
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal spread-copy");
  const o = { ...{ toString() { return "label" } } };
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal made-in-function");
  function make() { return { toString() { return "label" } }; }
  const o = make();
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal made-in-function-twice");
  function make() { return { toString() { return "label" } }; }
  make();
  const o = make();
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal literal-arrow");
  const o = { toString: () => { return "label" } };
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal class-field-arrow");
  class C { toString = () => { return "label" }; }
  const o = new C();
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-computed-literal prototype-create-arrow");
  const p = { toString: () => { return "label" } };
  const o = Object.create(p);
  const t = { [o]: 4 }; print(t.label);
}
{
  const print = printer("tostring-has-own literal");
  const o = { toString() { return "label" } };
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own literal-function");
  const o = { toString: function () { return "label" } };
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own literal-with-field");
  const o = { x: 1, toString() { return "label" } };
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own class-method");
  class C { toString() { return "label" } }
  const o = new C();
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own class-field");
  class C { toString = function () { return "label" }; }
  const o = new C();
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own subclass");
  class B { toString() { return "label" } }
  class C extends B {}
  const o = new C();
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own class-static");
  class C { static toString() { return "label" } }
  const o = C;
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own prototype-create");
  const p = { toString() { return "label" } };
  const o = Object.create(p);
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own prototype-literal");
  const p = { toString() { return "label" } };
  const o = { __proto__: p };
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own prototype-literal-with-field");
  const p = { toString() { return "label" } };
  const o = { __proto__: p, x: 1 };
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own prototype-set");
  const p = { toString() { return "label" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own prototype-set-with-field");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own prototype-reflect-set");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own prototype-proto-store");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own prototype-two-levels");
  const p = { toString() { return "label" } };
  const o = Object.create(Object.create(p));
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own prototype-of-class-instance");
  const p = { toString() { return "label" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own prototype-is-instance");
  class C { toString = function () { return "label" }; }
  const o = Object.create(new C());
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own stored-after");
  const o = {};
  o.toString = function () { return "label" };
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "label" };
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "label" };
  const o = Object.create(p);
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "label" };
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "label" };
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "label" };
  const o = new C();
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own constructor-function");
  function F() {}
  F.prototype.toString = function () { return "label" };
  const o = new F();
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "label" } };
  const o = new F();
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own constructor-function-this");
  function F() { this.toString = function () { return "label" }; }
  const o = new F();
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own getter");
  const o = { get toString() { return function () { return "label" }; } };
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "label" } });
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own assigned");
  const o = Object.assign({}, { toString() { return "label" } });
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own spread-copy");
  const o = { ...{ toString() { return "label" } } };
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own made-in-function");
  function make() { return { toString() { return "label" } }; }
  const o = make();
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own made-in-function-twice");
  function make() { return { toString() { return "label" } }; }
  make();
  const o = make();
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own literal-arrow");
  const o = { toString: () => { return "label" } };
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own class-field-arrow");
  class C { toString = () => { return "label" }; }
  const o = new C();
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-has-own prototype-create-arrow");
  const p = { toString: () => { return "label" } };
  const o = Object.create(p);
  print(Object.hasOwn({ label: 1 }, o), ({ label: 1 }).hasOwnProperty(o));
}
{
  const print = printer("tostring-delete literal");
  const o = { toString() { return "label" } };
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete literal-function");
  const o = { toString: function () { return "label" } };
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete literal-with-field");
  const o = { x: 1, toString() { return "label" } };
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete class-method");
  class C { toString() { return "label" } }
  const o = new C();
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete class-field");
  class C { toString = function () { return "label" }; }
  const o = new C();
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete subclass");
  class B { toString() { return "label" } }
  class C extends B {}
  const o = new C();
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete class-static");
  class C { static toString() { return "label" } }
  const o = C;
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete prototype-create");
  const p = { toString() { return "label" } };
  const o = Object.create(p);
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete prototype-literal");
  const p = { toString() { return "label" } };
  const o = { __proto__: p };
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete prototype-literal-with-field");
  const p = { toString() { return "label" } };
  const o = { __proto__: p, x: 1 };
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete prototype-set");
  const p = { toString() { return "label" } };
  const o = {};
  Object.setPrototypeOf(o, p);
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete prototype-set-with-field");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete prototype-reflect-set");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete prototype-proto-store");
  const p = { toString() { return "label" } };
  const o = { x: 1 };
  o.__proto__ = p;
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete prototype-two-levels");
  const p = { toString() { return "label" } };
  const o = Object.create(Object.create(p));
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete prototype-of-class-instance");
  const p = { toString() { return "label" } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete prototype-is-instance");
  class C { toString = function () { return "label" }; }
  const o = Object.create(new C());
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete stored-after");
  const o = {};
  o.toString = function () { return "label" };
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete stored-after-with-field");
  const o = { x: 1 };
  o.toString = function () { return "label" };
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete stored-after-on-prototype");
  const p = {};
  p.toString = function () { return "label" };
  const o = Object.create(p);
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toString = function () { return "label" };
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toString = function () { return "label" };
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toString = function () { return "label" };
  const o = new C();
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete constructor-function");
  function F() {}
  F.prototype.toString = function () { return "label" };
  const o = new F();
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete constructor-function-prototype-object");
  function F() {}
  F.prototype = { toString() { return "label" } };
  const o = new F();
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete constructor-function-this");
  function F() { this.toString = function () { return "label" }; }
  const o = new F();
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete getter");
  const o = { get toString() { return function () { return "label" }; } };
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete defined");
  const o = {};
  Object.defineProperty(o, "toString", { value: function () { return "label" } });
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete assigned");
  const o = Object.assign({}, { toString() { return "label" } });
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete spread-copy");
  const o = { ...{ toString() { return "label" } } };
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete made-in-function");
  function make() { return { toString() { return "label" } }; }
  const o = make();
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete made-in-function-twice");
  function make() { return { toString() { return "label" } }; }
  make();
  const o = make();
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete literal-arrow");
  const o = { toString: () => { return "label" } };
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete class-field-arrow");
  class C { toString = () => { return "label" }; }
  const o = new C();
  const t = { label: 1 }; delete t[o]; print(t.label);
}
{
  const print = printer("tostring-delete prototype-create-arrow");
  const p = { toString: () => { return "label" } };
  const o = Object.create(p);
  const t = { label: 1 }; delete t[o]; print(t.label);
}

console.log(lines.join("\n"));
