// toJSON is run by JSON.stringify, wherever the object got it from.
const lines = [];
function printer(label) {
  return (...values) => {
    let text = label + ":";
    for (let i = 0; i < values.length; i++) text += " " + String(values[i]);
    lines.push(text);
  };
}

{
  const print = printer("tojson literal");
  const o = { toJSON() { return 3 } };
  print(JSON.stringify(o));
}
{
  const print = printer("tojson literal-function");
  const o = { toJSON: function () { return 3 } };
  print(JSON.stringify(o));
}
{
  const print = printer("tojson literal-with-field");
  const o = { x: 1, toJSON() { return 3 } };
  print(JSON.stringify(o));
}
{
  const print = printer("tojson class-method");
  class C { toJSON() { return 3 } }
  const o = new C();
  print(JSON.stringify(o));
}
{
  const print = printer("tojson class-field");
  class C { toJSON = function () { return 3 }; }
  const o = new C();
  print(JSON.stringify(o));
}
{
  const print = printer("tojson subclass");
  class B { toJSON() { return 3 } }
  class C extends B {}
  const o = new C();
  print(JSON.stringify(o));
}
{
  const print = printer("tojson class-static");
  class C { static toJSON() { return 3 } }
  const o = C;
  print(JSON.stringify(o));
}
{
  const print = printer("tojson prototype-create");
  const p = { toJSON() { return 3 } };
  const o = Object.create(p);
  print(JSON.stringify(o));
}
{
  const print = printer("tojson prototype-literal");
  const p = { toJSON() { return 3 } };
  const o = { __proto__: p };
  print(JSON.stringify(o));
}
{
  const print = printer("tojson prototype-literal-with-field");
  const p = { toJSON() { return 3 } };
  const o = { __proto__: p, x: 1 };
  print(JSON.stringify(o));
}
{
  const print = printer("tojson prototype-set");
  const p = { toJSON() { return 3 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(JSON.stringify(o));
}
{
  const print = printer("tojson prototype-set-with-field");
  const p = { toJSON() { return 3 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(JSON.stringify(o));
}
{
  const print = printer("tojson prototype-reflect-set");
  const p = { toJSON() { return 3 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(JSON.stringify(o));
}
{
  const print = printer("tojson prototype-proto-store");
  const p = { toJSON() { return 3 } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(JSON.stringify(o));
}
{
  const print = printer("tojson prototype-two-levels");
  const p = { toJSON() { return 3 } };
  const o = Object.create(Object.create(p));
  print(JSON.stringify(o));
}
{
  const print = printer("tojson prototype-of-class-instance");
  const p = { toJSON() { return 3 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(JSON.stringify(o));
}
{
  const print = printer("tojson prototype-is-instance");
  class C { toJSON = function () { return 3 }; }
  const o = Object.create(new C());
  print(JSON.stringify(o));
}
{
  const print = printer("tojson stored-after");
  const o = {};
  o.toJSON = function () { return 3 };
  print(JSON.stringify(o));
}
{
  const print = printer("tojson stored-after-with-field");
  const o = { x: 1 };
  o.toJSON = function () { return 3 };
  print(JSON.stringify(o));
}
{
  const print = printer("tojson stored-after-on-prototype");
  const p = {};
  p.toJSON = function () { return 3 };
  const o = Object.create(p);
  print(JSON.stringify(o));
}
{
  const print = printer("tojson stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toJSON = function () { return 3 };
  print(JSON.stringify(o));
}
{
  const print = printer("tojson stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toJSON = function () { return 3 };
  print(JSON.stringify(o));
}
{
  const print = printer("tojson stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toJSON = function () { return 3 };
  const o = new C();
  print(JSON.stringify(o));
}
{
  const print = printer("tojson constructor-function");
  function F() {}
  F.prototype.toJSON = function () { return 3 };
  const o = new F();
  print(JSON.stringify(o));
}
{
  const print = printer("tojson constructor-function-prototype-object");
  function F() {}
  F.prototype = { toJSON() { return 3 } };
  const o = new F();
  print(JSON.stringify(o));
}
{
  const print = printer("tojson constructor-function-this");
  function F() { this.toJSON = function () { return 3 }; }
  const o = new F();
  print(JSON.stringify(o));
}
{
  const print = printer("tojson getter");
  const o = { get toJSON() { return function () { return 3 }; } };
  print(JSON.stringify(o));
}
{
  const print = printer("tojson defined");
  const o = {};
  Object.defineProperty(o, "toJSON", { value: function () { return 3 } });
  print(JSON.stringify(o));
}
{
  const print = printer("tojson assigned");
  const o = Object.assign({}, { toJSON() { return 3 } });
  print(JSON.stringify(o));
}
{
  const print = printer("tojson spread-copy");
  const o = { ...{ toJSON() { return 3 } } };
  print(JSON.stringify(o));
}
{
  const print = printer("tojson made-in-function");
  function make() { return { toJSON() { return 3 } }; }
  const o = make();
  print(JSON.stringify(o));
}
{
  const print = printer("tojson made-in-function-twice");
  function make() { return { toJSON() { return 3 } }; }
  make();
  const o = make();
  print(JSON.stringify(o));
}
{
  const print = printer("tojson literal-arrow");
  const o = { toJSON: () => { return 3 } };
  print(JSON.stringify(o));
}
{
  const print = printer("tojson class-field-arrow");
  class C { toJSON = () => { return 3 }; }
  const o = new C();
  print(JSON.stringify(o));
}
{
  const print = printer("tojson prototype-create-arrow");
  const p = { toJSON: () => { return 3 } };
  const o = Object.create(p);
  print(JSON.stringify(o));
}
{
  const print = printer("tojson-nested literal");
  const o = { toJSON() { return 3 } };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested literal-function");
  const o = { toJSON: function () { return 3 } };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested literal-with-field");
  const o = { x: 1, toJSON() { return 3 } };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested class-method");
  class C { toJSON() { return 3 } }
  const o = new C();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested class-field");
  class C { toJSON = function () { return 3 }; }
  const o = new C();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested subclass");
  class B { toJSON() { return 3 } }
  class C extends B {}
  const o = new C();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested class-static");
  class C { static toJSON() { return 3 } }
  const o = C;
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested prototype-create");
  const p = { toJSON() { return 3 } };
  const o = Object.create(p);
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested prototype-literal");
  const p = { toJSON() { return 3 } };
  const o = { __proto__: p };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested prototype-literal-with-field");
  const p = { toJSON() { return 3 } };
  const o = { __proto__: p, x: 1 };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested prototype-set");
  const p = { toJSON() { return 3 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested prototype-set-with-field");
  const p = { toJSON() { return 3 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested prototype-reflect-set");
  const p = { toJSON() { return 3 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested prototype-proto-store");
  const p = { toJSON() { return 3 } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested prototype-two-levels");
  const p = { toJSON() { return 3 } };
  const o = Object.create(Object.create(p));
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested prototype-of-class-instance");
  const p = { toJSON() { return 3 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested prototype-is-instance");
  class C { toJSON = function () { return 3 }; }
  const o = Object.create(new C());
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested stored-after");
  const o = {};
  o.toJSON = function () { return 3 };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested stored-after-with-field");
  const o = { x: 1 };
  o.toJSON = function () { return 3 };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested stored-after-on-prototype");
  const p = {};
  p.toJSON = function () { return 3 };
  const o = Object.create(p);
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toJSON = function () { return 3 };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toJSON = function () { return 3 };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toJSON = function () { return 3 };
  const o = new C();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested constructor-function");
  function F() {}
  F.prototype.toJSON = function () { return 3 };
  const o = new F();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested constructor-function-prototype-object");
  function F() {}
  F.prototype = { toJSON() { return 3 } };
  const o = new F();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested constructor-function-this");
  function F() { this.toJSON = function () { return 3 }; }
  const o = new F();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested getter");
  const o = { get toJSON() { return function () { return 3 }; } };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested defined");
  const o = {};
  Object.defineProperty(o, "toJSON", { value: function () { return 3 } });
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested assigned");
  const o = Object.assign({}, { toJSON() { return 3 } });
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested spread-copy");
  const o = { ...{ toJSON() { return 3 } } };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested made-in-function");
  function make() { return { toJSON() { return 3 } }; }
  const o = make();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested made-in-function-twice");
  function make() { return { toJSON() { return 3 } }; }
  make();
  const o = make();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested literal-arrow");
  const o = { toJSON: () => { return 3 } };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested class-field-arrow");
  class C { toJSON = () => { return 3 }; }
  const o = new C();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-nested prototype-create-arrow");
  const p = { toJSON: () => { return 3 } };
  const o = Object.create(p);
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("tojson-array literal");
  const o = { toJSON() { return 3 } };
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array literal-function");
  const o = { toJSON: function () { return 3 } };
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array literal-with-field");
  const o = { x: 1, toJSON() { return 3 } };
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array class-method");
  class C { toJSON() { return 3 } }
  const o = new C();
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array class-field");
  class C { toJSON = function () { return 3 }; }
  const o = new C();
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array subclass");
  class B { toJSON() { return 3 } }
  class C extends B {}
  const o = new C();
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array class-static");
  class C { static toJSON() { return 3 } }
  const o = C;
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array prototype-create");
  const p = { toJSON() { return 3 } };
  const o = Object.create(p);
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array prototype-literal");
  const p = { toJSON() { return 3 } };
  const o = { __proto__: p };
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array prototype-literal-with-field");
  const p = { toJSON() { return 3 } };
  const o = { __proto__: p, x: 1 };
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array prototype-set");
  const p = { toJSON() { return 3 } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array prototype-set-with-field");
  const p = { toJSON() { return 3 } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array prototype-reflect-set");
  const p = { toJSON() { return 3 } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array prototype-proto-store");
  const p = { toJSON() { return 3 } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array prototype-two-levels");
  const p = { toJSON() { return 3 } };
  const o = Object.create(Object.create(p));
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array prototype-of-class-instance");
  const p = { toJSON() { return 3 } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array prototype-is-instance");
  class C { toJSON = function () { return 3 }; }
  const o = Object.create(new C());
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array stored-after");
  const o = {};
  o.toJSON = function () { return 3 };
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array stored-after-with-field");
  const o = { x: 1 };
  o.toJSON = function () { return 3 };
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array stored-after-on-prototype");
  const p = {};
  p.toJSON = function () { return 3 };
  const o = Object.create(p);
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toJSON = function () { return 3 };
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toJSON = function () { return 3 };
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toJSON = function () { return 3 };
  const o = new C();
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array constructor-function");
  function F() {}
  F.prototype.toJSON = function () { return 3 };
  const o = new F();
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array constructor-function-prototype-object");
  function F() {}
  F.prototype = { toJSON() { return 3 } };
  const o = new F();
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array constructor-function-this");
  function F() { this.toJSON = function () { return 3 }; }
  const o = new F();
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array getter");
  const o = { get toJSON() { return function () { return 3 }; } };
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array defined");
  const o = {};
  Object.defineProperty(o, "toJSON", { value: function () { return 3 } });
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array assigned");
  const o = Object.assign({}, { toJSON() { return 3 } });
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array spread-copy");
  const o = { ...{ toJSON() { return 3 } } };
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array made-in-function");
  function make() { return { toJSON() { return 3 } }; }
  const o = make();
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array made-in-function-twice");
  function make() { return { toJSON() { return 3 } }; }
  make();
  const o = make();
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array literal-arrow");
  const o = { toJSON: () => { return 3 } };
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array class-field-arrow");
  class C { toJSON = () => { return 3 }; }
  const o = new C();
  print(JSON.stringify([o]));
}
{
  const print = printer("tojson-array prototype-create-arrow");
  const p = { toJSON: () => { return 3 } };
  const o = Object.create(p);
  print(JSON.stringify([o]));
}
{
  const print = printer("replacer-tojson-key literal");
  const o = { toJSON(key) { return key } };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key literal-function");
  const o = { toJSON: function (key) { return key } };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key literal-with-field");
  const o = { x: 1, toJSON(key) { return key } };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key class-method");
  class C { toJSON(key) { return key } }
  const o = new C();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key class-field");
  class C { toJSON = function (key) { return key }; }
  const o = new C();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key subclass");
  class B { toJSON(key) { return key } }
  class C extends B {}
  const o = new C();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key class-static");
  class C { static toJSON(key) { return key } }
  const o = C;
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key prototype-create");
  const p = { toJSON(key) { return key } };
  const o = Object.create(p);
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key prototype-literal");
  const p = { toJSON(key) { return key } };
  const o = { __proto__: p };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key prototype-literal-with-field");
  const p = { toJSON(key) { return key } };
  const o = { __proto__: p, x: 1 };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key prototype-set");
  const p = { toJSON(key) { return key } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key prototype-set-with-field");
  const p = { toJSON(key) { return key } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key prototype-reflect-set");
  const p = { toJSON(key) { return key } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key prototype-proto-store");
  const p = { toJSON(key) { return key } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key prototype-two-levels");
  const p = { toJSON(key) { return key } };
  const o = Object.create(Object.create(p));
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key prototype-of-class-instance");
  const p = { toJSON(key) { return key } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key prototype-is-instance");
  class C { toJSON = function (key) { return key }; }
  const o = Object.create(new C());
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key stored-after");
  const o = {};
  o.toJSON = function (key) { return key };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key stored-after-with-field");
  const o = { x: 1 };
  o.toJSON = function (key) { return key };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key stored-after-on-prototype");
  const p = {};
  p.toJSON = function (key) { return key };
  const o = Object.create(p);
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.toJSON = function (key) { return key };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.toJSON = function (key) { return key };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.toJSON = function (key) { return key };
  const o = new C();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key constructor-function");
  function F() {}
  F.prototype.toJSON = function (key) { return key };
  const o = new F();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key constructor-function-prototype-object");
  function F() {}
  F.prototype = { toJSON(key) { return key } };
  const o = new F();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key constructor-function-this");
  function F() { this.toJSON = function (key) { return key }; }
  const o = new F();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key getter");
  const o = { get toJSON() { return function (key) { return key }; } };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key defined");
  const o = {};
  Object.defineProperty(o, "toJSON", { value: function (key) { return key } });
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key assigned");
  const o = Object.assign({}, { toJSON(key) { return key } });
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key spread-copy");
  const o = { ...{ toJSON(key) { return key } } };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key made-in-function");
  function make() { return { toJSON(key) { return key } }; }
  const o = make();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key made-in-function-twice");
  function make() { return { toJSON(key) { return key } }; }
  make();
  const o = make();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key literal-arrow");
  const o = { toJSON: (key) => { return key } };
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key class-field-arrow");
  class C { toJSON = (key) => { return key }; }
  const o = new C();
  print(JSON.stringify({ a: o }));
}
{
  const print = printer("replacer-tojson-key prototype-create-arrow");
  const p = { toJSON: (key) => { return key } };
  const o = Object.create(p);
  print(JSON.stringify({ a: o }));
}

console.log(lines.join("\n"));
