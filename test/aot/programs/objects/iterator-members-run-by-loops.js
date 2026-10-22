// Symbol.iterator, next and return are run by loops, spreads and patterns, wherever the object got them from.
const lines = [];
function printer(label) {
  return (...values) => {
    let text = label + ":";
    for (let i = 0; i < values.length; i++) text += " " + String(values[i]);
    lines.push(text);
  };
}

{
  const print = printer("iterator-for-of literal");
  const o = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of literal-function");
  const o = { [Symbol.iterator]: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of literal-with-field");
  const o = { x: 1, [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of class-method");
  class C { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  const o = new C();
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of class-field");
  class C { [Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new C();
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of subclass");
  class B { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  class C extends B {}
  const o = new C();
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of class-static");
  class C { static [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  const o = C;
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of prototype-create");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(p);
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of prototype-literal");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { __proto__: p };
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of prototype-literal-with-field");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { __proto__: p, x: 1 };
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of prototype-set");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = {};
  Object.setPrototypeOf(o, p);
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of prototype-set-with-field");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of prototype-reflect-set");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of prototype-proto-store");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  o.__proto__ = p;
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of prototype-two-levels");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(Object.create(p));
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of prototype-of-class-instance");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of prototype-is-instance");
  class C { [Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = Object.create(new C());
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of stored-after");
  const o = {};
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of stored-after-with-field");
  const o = { x: 1 };
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of stored-after-on-prototype");
  const p = {};
  p[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = Object.create(p);
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of stored-on-class-prototype");
  class C { x = 1; }
  C.prototype[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = new C();
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of constructor-function");
  function F() {}
  F.prototype[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = new F();
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of constructor-function-prototype-object");
  function F() {}
  F.prototype = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = new F();
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of constructor-function-this");
  function F() { this[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new F();
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of getter");
  const o = { get [Symbol.iterator]() { return function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; } };
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of defined");
  const o = {};
  Object.defineProperty(o, Symbol.iterator, { value: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } });
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of assigned");
  const o = Object.assign({}, { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } });
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of spread-copy");
  const o = { ...{ [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } } };
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of made-in-function");
  function make() { return { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }; }
  const o = make();
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of made-in-function-twice");
  function make() { return { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }; }
  make();
  const o = make();
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of literal-arrow");
  const o = { [Symbol.iterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of class-field-arrow");
  class C { [Symbol.iterator] = () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new C();
  for (const x of o) print(x);
}
{
  const print = printer("iterator-for-of prototype-create-arrow");
  const p = { [Symbol.iterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(p);
  for (const x of o) print(x);
}
{
  const print = printer("iterator-spread literal");
  const o = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print([...o].length);
}
{
  const print = printer("iterator-spread literal-function");
  const o = { [Symbol.iterator]: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print([...o].length);
}
{
  const print = printer("iterator-spread literal-with-field");
  const o = { x: 1, [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print([...o].length);
}
{
  const print = printer("iterator-spread class-method");
  class C { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  const o = new C();
  print([...o].length);
}
{
  const print = printer("iterator-spread class-field");
  class C { [Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new C();
  print([...o].length);
}
{
  const print = printer("iterator-spread subclass");
  class B { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  class C extends B {}
  const o = new C();
  print([...o].length);
}
{
  const print = printer("iterator-spread class-static");
  class C { static [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  const o = C;
  print([...o].length);
}
{
  const print = printer("iterator-spread prototype-create");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(p);
  print([...o].length);
}
{
  const print = printer("iterator-spread prototype-literal");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { __proto__: p };
  print([...o].length);
}
{
  const print = printer("iterator-spread prototype-literal-with-field");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { __proto__: p, x: 1 };
  print([...o].length);
}
{
  const print = printer("iterator-spread prototype-set");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print([...o].length);
}
{
  const print = printer("iterator-spread prototype-set-with-field");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print([...o].length);
}
{
  const print = printer("iterator-spread prototype-reflect-set");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print([...o].length);
}
{
  const print = printer("iterator-spread prototype-proto-store");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  o.__proto__ = p;
  print([...o].length);
}
{
  const print = printer("iterator-spread prototype-two-levels");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(Object.create(p));
  print([...o].length);
}
{
  const print = printer("iterator-spread prototype-of-class-instance");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print([...o].length);
}
{
  const print = printer("iterator-spread prototype-is-instance");
  class C { [Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = Object.create(new C());
  print([...o].length);
}
{
  const print = printer("iterator-spread stored-after");
  const o = {};
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print([...o].length);
}
{
  const print = printer("iterator-spread stored-after-with-field");
  const o = { x: 1 };
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print([...o].length);
}
{
  const print = printer("iterator-spread stored-after-on-prototype");
  const p = {};
  p[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = Object.create(p);
  print([...o].length);
}
{
  const print = printer("iterator-spread stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print([...o].length);
}
{
  const print = printer("iterator-spread stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print([...o].length);
}
{
  const print = printer("iterator-spread stored-on-class-prototype");
  class C { x = 1; }
  C.prototype[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = new C();
  print([...o].length);
}
{
  const print = printer("iterator-spread constructor-function");
  function F() {}
  F.prototype[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = new F();
  print([...o].length);
}
{
  const print = printer("iterator-spread constructor-function-prototype-object");
  function F() {}
  F.prototype = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = new F();
  print([...o].length);
}
{
  const print = printer("iterator-spread constructor-function-this");
  function F() { this[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new F();
  print([...o].length);
}
{
  const print = printer("iterator-spread getter");
  const o = { get [Symbol.iterator]() { return function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; } };
  print([...o].length);
}
{
  const print = printer("iterator-spread defined");
  const o = {};
  Object.defineProperty(o, Symbol.iterator, { value: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } });
  print([...o].length);
}
{
  const print = printer("iterator-spread assigned");
  const o = Object.assign({}, { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } });
  print([...o].length);
}
{
  const print = printer("iterator-spread spread-copy");
  const o = { ...{ [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } } };
  print([...o].length);
}
{
  const print = printer("iterator-spread made-in-function");
  function make() { return { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }; }
  const o = make();
  print([...o].length);
}
{
  const print = printer("iterator-spread made-in-function-twice");
  function make() { return { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }; }
  make();
  const o = make();
  print([...o].length);
}
{
  const print = printer("iterator-spread literal-arrow");
  const o = { [Symbol.iterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print([...o].length);
}
{
  const print = printer("iterator-spread class-field-arrow");
  class C { [Symbol.iterator] = () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new C();
  print([...o].length);
}
{
  const print = printer("iterator-spread prototype-create-arrow");
  const p = { [Symbol.iterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(p);
  print([...o].length);
}
{
  const print = printer("iterator-pattern literal");
  const o = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern literal-function");
  const o = { [Symbol.iterator]: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern literal-with-field");
  const o = { x: 1, [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern class-method");
  class C { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  const o = new C();
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern class-field");
  class C { [Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new C();
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern subclass");
  class B { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  class C extends B {}
  const o = new C();
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern class-static");
  class C { static [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  const o = C;
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern prototype-create");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(p);
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern prototype-literal");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { __proto__: p };
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern prototype-literal-with-field");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { __proto__: p, x: 1 };
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern prototype-set");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = {};
  Object.setPrototypeOf(o, p);
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern prototype-set-with-field");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern prototype-reflect-set");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern prototype-proto-store");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  o.__proto__ = p;
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern prototype-two-levels");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(Object.create(p));
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern prototype-of-class-instance");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern prototype-is-instance");
  class C { [Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = Object.create(new C());
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern stored-after");
  const o = {};
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern stored-after-with-field");
  const o = { x: 1 };
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern stored-after-on-prototype");
  const p = {};
  p[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = Object.create(p);
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern stored-on-class-prototype");
  class C { x = 1; }
  C.prototype[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = new C();
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern constructor-function");
  function F() {}
  F.prototype[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = new F();
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern constructor-function-prototype-object");
  function F() {}
  F.prototype = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = new F();
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern constructor-function-this");
  function F() { this[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new F();
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern getter");
  const o = { get [Symbol.iterator]() { return function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; } };
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern defined");
  const o = {};
  Object.defineProperty(o, Symbol.iterator, { value: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } });
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern assigned");
  const o = Object.assign({}, { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } });
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern spread-copy");
  const o = { ...{ [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } } };
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern made-in-function");
  function make() { return { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }; }
  const o = make();
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern made-in-function-twice");
  function make() { return { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }; }
  make();
  const o = make();
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern literal-arrow");
  const o = { [Symbol.iterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern class-field-arrow");
  class C { [Symbol.iterator] = () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new C();
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-pattern prototype-create-arrow");
  const p = { [Symbol.iterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(p);
  const [a, b] = o; print(a, b);
}
{
  const print = printer("iterator-call-spread literal");
  const o = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print(...o);
}
{
  const print = printer("iterator-call-spread literal-function");
  const o = { [Symbol.iterator]: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print(...o);
}
{
  const print = printer("iterator-call-spread literal-with-field");
  const o = { x: 1, [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print(...o);
}
{
  const print = printer("iterator-call-spread class-method");
  class C { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  const o = new C();
  print(...o);
}
{
  const print = printer("iterator-call-spread class-field");
  class C { [Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new C();
  print(...o);
}
{
  const print = printer("iterator-call-spread subclass");
  class B { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  class C extends B {}
  const o = new C();
  print(...o);
}
{
  const print = printer("iterator-call-spread class-static");
  class C { static [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  const o = C;
  print(...o);
}
{
  const print = printer("iterator-call-spread prototype-create");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(p);
  print(...o);
}
{
  const print = printer("iterator-call-spread prototype-literal");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { __proto__: p };
  print(...o);
}
{
  const print = printer("iterator-call-spread prototype-literal-with-field");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { __proto__: p, x: 1 };
  print(...o);
}
{
  const print = printer("iterator-call-spread prototype-set");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(...o);
}
{
  const print = printer("iterator-call-spread prototype-set-with-field");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(...o);
}
{
  const print = printer("iterator-call-spread prototype-reflect-set");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(...o);
}
{
  const print = printer("iterator-call-spread prototype-proto-store");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(...o);
}
{
  const print = printer("iterator-call-spread prototype-two-levels");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(Object.create(p));
  print(...o);
}
{
  const print = printer("iterator-call-spread prototype-of-class-instance");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(...o);
}
{
  const print = printer("iterator-call-spread prototype-is-instance");
  class C { [Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = Object.create(new C());
  print(...o);
}
{
  const print = printer("iterator-call-spread stored-after");
  const o = {};
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print(...o);
}
{
  const print = printer("iterator-call-spread stored-after-with-field");
  const o = { x: 1 };
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print(...o);
}
{
  const print = printer("iterator-call-spread stored-after-on-prototype");
  const p = {};
  p[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = Object.create(p);
  print(...o);
}
{
  const print = printer("iterator-call-spread stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print(...o);
}
{
  const print = printer("iterator-call-spread stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print(...o);
}
{
  const print = printer("iterator-call-spread stored-on-class-prototype");
  class C { x = 1; }
  C.prototype[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = new C();
  print(...o);
}
{
  const print = printer("iterator-call-spread constructor-function");
  function F() {}
  F.prototype[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = new F();
  print(...o);
}
{
  const print = printer("iterator-call-spread constructor-function-prototype-object");
  function F() {}
  F.prototype = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = new F();
  print(...o);
}
{
  const print = printer("iterator-call-spread constructor-function-this");
  function F() { this[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new F();
  print(...o);
}
{
  const print = printer("iterator-call-spread getter");
  const o = { get [Symbol.iterator]() { return function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; } };
  print(...o);
}
{
  const print = printer("iterator-call-spread defined");
  const o = {};
  Object.defineProperty(o, Symbol.iterator, { value: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } });
  print(...o);
}
{
  const print = printer("iterator-call-spread assigned");
  const o = Object.assign({}, { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } });
  print(...o);
}
{
  const print = printer("iterator-call-spread spread-copy");
  const o = { ...{ [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } } };
  print(...o);
}
{
  const print = printer("iterator-call-spread made-in-function");
  function make() { return { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }; }
  const o = make();
  print(...o);
}
{
  const print = printer("iterator-call-spread made-in-function-twice");
  function make() { return { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }; }
  make();
  const o = make();
  print(...o);
}
{
  const print = printer("iterator-call-spread literal-arrow");
  const o = { [Symbol.iterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print(...o);
}
{
  const print = printer("iterator-call-spread class-field-arrow");
  class C { [Symbol.iterator] = () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new C();
  print(...o);
}
{
  const print = printer("iterator-call-spread prototype-create-arrow");
  const p = { [Symbol.iterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(p);
  print(...o);
}
{
  const print = printer("iterator-set literal");
  const o = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print(new Set(o).size);
}
{
  const print = printer("iterator-set literal-function");
  const o = { [Symbol.iterator]: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print(new Set(o).size);
}
{
  const print = printer("iterator-set literal-with-field");
  const o = { x: 1, [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print(new Set(o).size);
}
{
  const print = printer("iterator-set class-method");
  class C { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  const o = new C();
  print(new Set(o).size);
}
{
  const print = printer("iterator-set class-field");
  class C { [Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new C();
  print(new Set(o).size);
}
{
  const print = printer("iterator-set subclass");
  class B { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  class C extends B {}
  const o = new C();
  print(new Set(o).size);
}
{
  const print = printer("iterator-set class-static");
  class C { static [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  const o = C;
  print(new Set(o).size);
}
{
  const print = printer("iterator-set prototype-create");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(p);
  print(new Set(o).size);
}
{
  const print = printer("iterator-set prototype-literal");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { __proto__: p };
  print(new Set(o).size);
}
{
  const print = printer("iterator-set prototype-literal-with-field");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { __proto__: p, x: 1 };
  print(new Set(o).size);
}
{
  const print = printer("iterator-set prototype-set");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(new Set(o).size);
}
{
  const print = printer("iterator-set prototype-set-with-field");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(new Set(o).size);
}
{
  const print = printer("iterator-set prototype-reflect-set");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(new Set(o).size);
}
{
  const print = printer("iterator-set prototype-proto-store");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(new Set(o).size);
}
{
  const print = printer("iterator-set prototype-two-levels");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(Object.create(p));
  print(new Set(o).size);
}
{
  const print = printer("iterator-set prototype-of-class-instance");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(new Set(o).size);
}
{
  const print = printer("iterator-set prototype-is-instance");
  class C { [Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = Object.create(new C());
  print(new Set(o).size);
}
{
  const print = printer("iterator-set stored-after");
  const o = {};
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print(new Set(o).size);
}
{
  const print = printer("iterator-set stored-after-with-field");
  const o = { x: 1 };
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print(new Set(o).size);
}
{
  const print = printer("iterator-set stored-after-on-prototype");
  const p = {};
  p[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = Object.create(p);
  print(new Set(o).size);
}
{
  const print = printer("iterator-set stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print(new Set(o).size);
}
{
  const print = printer("iterator-set stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print(new Set(o).size);
}
{
  const print = printer("iterator-set stored-on-class-prototype");
  class C { x = 1; }
  C.prototype[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = new C();
  print(new Set(o).size);
}
{
  const print = printer("iterator-set constructor-function");
  function F() {}
  F.prototype[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = new F();
  print(new Set(o).size);
}
{
  const print = printer("iterator-set constructor-function-prototype-object");
  function F() {}
  F.prototype = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = new F();
  print(new Set(o).size);
}
{
  const print = printer("iterator-set constructor-function-this");
  function F() { this[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new F();
  print(new Set(o).size);
}
{
  const print = printer("iterator-set getter");
  const o = { get [Symbol.iterator]() { return function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; } };
  print(new Set(o).size);
}
{
  const print = printer("iterator-set defined");
  const o = {};
  Object.defineProperty(o, Symbol.iterator, { value: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } });
  print(new Set(o).size);
}
{
  const print = printer("iterator-set assigned");
  const o = Object.assign({}, { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } });
  print(new Set(o).size);
}
{
  const print = printer("iterator-set spread-copy");
  const o = { ...{ [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } } };
  print(new Set(o).size);
}
{
  const print = printer("iterator-set made-in-function");
  function make() { return { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }; }
  const o = make();
  print(new Set(o).size);
}
{
  const print = printer("iterator-set made-in-function-twice");
  function make() { return { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }; }
  make();
  const o = make();
  print(new Set(o).size);
}
{
  const print = printer("iterator-set literal-arrow");
  const o = { [Symbol.iterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print(new Set(o).size);
}
{
  const print = printer("iterator-set class-field-arrow");
  class C { [Symbol.iterator] = () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new C();
  print(new Set(o).size);
}
{
  const print = printer("iterator-set prototype-create-arrow");
  const p = { [Symbol.iterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(p);
  print(new Set(o).size);
}
{
  const print = printer("iterator-new-spread literal");
  const o = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread literal-function");
  const o = { [Symbol.iterator]: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread literal-with-field");
  const o = { x: 1, [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread class-method");
  class C { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  const o = new C();
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread class-field");
  class C { [Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new C();
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread subclass");
  class B { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  class C extends B {}
  const o = new C();
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread class-static");
  class C { static [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }
  const o = C;
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread prototype-create");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(p);
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread prototype-literal");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { __proto__: p };
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread prototype-literal-with-field");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { __proto__: p, x: 1 };
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread prototype-set");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = {};
  Object.setPrototypeOf(o, p);
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread prototype-set-with-field");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread prototype-reflect-set");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread prototype-proto-store");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = { x: 1 };
  o.__proto__ = p;
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread prototype-two-levels");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(Object.create(p));
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread prototype-of-class-instance");
  const p = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread prototype-is-instance");
  class C { [Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = Object.create(new C());
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread stored-after");
  const o = {};
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread stored-after-with-field");
  const o = { x: 1 };
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread stored-after-on-prototype");
  const p = {};
  p[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = Object.create(p);
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread stored-on-class-prototype");
  class C { x = 1; }
  C.prototype[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = new C();
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread constructor-function");
  function F() {}
  F.prototype[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } };
  const o = new F();
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread constructor-function-prototype-object");
  function F() {}
  F.prototype = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = new F();
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread constructor-function-this");
  function F() { this[Symbol.iterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new F();
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread getter");
  const o = { get [Symbol.iterator]() { return function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; } };
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread defined");
  const o = {};
  Object.defineProperty(o, Symbol.iterator, { value: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } });
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread assigned");
  const o = Object.assign({}, { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } });
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread spread-copy");
  const o = { ...{ [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } } };
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread made-in-function");
  function make() { return { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }; }
  const o = make();
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread made-in-function-twice");
  function make() { return { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } }; }
  make();
  const o = make();
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread literal-arrow");
  const o = { [Symbol.iterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread class-field-arrow");
  class C { [Symbol.iterator] = () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } }; }
  const o = new C();
  print(new Array(...o, 5).length);
}
{
  const print = printer("iterator-new-spread prototype-create-arrow");
  const p = { [Symbol.iterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ } } } } };
  const o = Object.create(p);
  print(new Array(...o, 5).length);
}
{
  const print = printer("next-for-of literal");
  let count = 0;
  const o = { next() { return { done: ++count > 2, value: count } } };
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of literal-function");
  let count = 0;
  const o = { next: function () { return { done: ++count > 2, value: count } } };
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of literal-with-field");
  let count = 0;
  const o = { x: 1, next() { return { done: ++count > 2, value: count } } };
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of class-method");
  let count = 0;
  class C { next() { return { done: ++count > 2, value: count } } }
  const o = new C();
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of class-field");
  let count = 0;
  class C { next = function () { return { done: ++count > 2, value: count } }; }
  const o = new C();
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of subclass");
  let count = 0;
  class B { next() { return { done: ++count > 2, value: count } } }
  class C extends B {}
  const o = new C();
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of class-static");
  let count = 0;
  class C { static next() { return { done: ++count > 2, value: count } } }
  const o = C;
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of prototype-create");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = Object.create(p);
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of prototype-literal");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = { __proto__: p };
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of prototype-literal-with-field");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = { __proto__: p, x: 1 };
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of prototype-set");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = {};
  Object.setPrototypeOf(o, p);
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of prototype-set-with-field");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of prototype-reflect-set");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of prototype-proto-store");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = { x: 1 };
  o.__proto__ = p;
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of prototype-two-levels");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = Object.create(Object.create(p));
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of prototype-of-class-instance");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of prototype-is-instance");
  let count = 0;
  class C { next = function () { return { done: ++count > 2, value: count } }; }
  const o = Object.create(new C());
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of stored-after");
  let count = 0;
  const o = {};
  o.next = function () { return { done: ++count > 2, value: count } };
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of stored-after-with-field");
  let count = 0;
  const o = { x: 1 };
  o.next = function () { return { done: ++count > 2, value: count } };
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of stored-after-on-prototype");
  let count = 0;
  const p = {};
  p.next = function () { return { done: ++count > 2, value: count } };
  const o = Object.create(p);
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of stored-after-on-prototype-late");
  let count = 0;
  const p = { x: 1 };
  const o = Object.create(p);
  p.next = function () { return { done: ++count > 2, value: count } };
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of stored-after-on-instance");
  let count = 0;
  class C { x = 1; }
  const o = new C();
  o.next = function () { return { done: ++count > 2, value: count } };
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of stored-on-class-prototype");
  let count = 0;
  class C { x = 1; }
  C.prototype.next = function () { return { done: ++count > 2, value: count } };
  const o = new C();
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of constructor-function");
  let count = 0;
  function F() {}
  F.prototype.next = function () { return { done: ++count > 2, value: count } };
  const o = new F();
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of constructor-function-prototype-object");
  let count = 0;
  function F() {}
  F.prototype = { next() { return { done: ++count > 2, value: count } } };
  const o = new F();
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of constructor-function-this");
  let count = 0;
  function F() { this.next = function () { return { done: ++count > 2, value: count } }; }
  const o = new F();
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of getter");
  let count = 0;
  const o = { get next() { return function () { return { done: ++count > 2, value: count } }; } };
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of defined");
  let count = 0;
  const o = {};
  Object.defineProperty(o, "next", { value: function () { return { done: ++count > 2, value: count } } });
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of assigned");
  let count = 0;
  const o = Object.assign({}, { next() { return { done: ++count > 2, value: count } } });
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of spread-copy");
  let count = 0;
  const o = { ...{ next() { return { done: ++count > 2, value: count } } } };
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of made-in-function");
  let count = 0;
  function make() { return { next() { return { done: ++count > 2, value: count } } }; }
  const o = make();
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of made-in-function-twice");
  let count = 0;
  function make() { return { next() { return { done: ++count > 2, value: count } } }; }
  make();
  const o = make();
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of literal-arrow");
  let count = 0;
  const o = { next: () => { return { done: ++count > 2, value: count } } };
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of class-field-arrow");
  let count = 0;
  class C { next = () => { return { done: ++count > 2, value: count } }; }
  const o = new C();
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-for-of prototype-create-arrow");
  let count = 0;
  const p = { next: () => { return { done: ++count > 2, value: count } } };
  const o = Object.create(p);
  const it = { [Symbol.iterator]() { return o; } }; for (const x of it) print(x);
}
{
  const print = printer("next-spread literal");
  let count = 0;
  const o = { next() { return { done: ++count > 2, value: count } } };
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread literal-function");
  let count = 0;
  const o = { next: function () { return { done: ++count > 2, value: count } } };
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread literal-with-field");
  let count = 0;
  const o = { x: 1, next() { return { done: ++count > 2, value: count } } };
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread class-method");
  let count = 0;
  class C { next() { return { done: ++count > 2, value: count } } }
  const o = new C();
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread class-field");
  let count = 0;
  class C { next = function () { return { done: ++count > 2, value: count } }; }
  const o = new C();
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread subclass");
  let count = 0;
  class B { next() { return { done: ++count > 2, value: count } } }
  class C extends B {}
  const o = new C();
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread class-static");
  let count = 0;
  class C { static next() { return { done: ++count > 2, value: count } } }
  const o = C;
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread prototype-create");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = Object.create(p);
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread prototype-literal");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = { __proto__: p };
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread prototype-literal-with-field");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = { __proto__: p, x: 1 };
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread prototype-set");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = {};
  Object.setPrototypeOf(o, p);
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread prototype-set-with-field");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread prototype-reflect-set");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread prototype-proto-store");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = { x: 1 };
  o.__proto__ = p;
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread prototype-two-levels");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  const o = Object.create(Object.create(p));
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread prototype-of-class-instance");
  let count = 0;
  const p = { next() { return { done: ++count > 2, value: count } } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread prototype-is-instance");
  let count = 0;
  class C { next = function () { return { done: ++count > 2, value: count } }; }
  const o = Object.create(new C());
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread stored-after");
  let count = 0;
  const o = {};
  o.next = function () { return { done: ++count > 2, value: count } };
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread stored-after-with-field");
  let count = 0;
  const o = { x: 1 };
  o.next = function () { return { done: ++count > 2, value: count } };
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread stored-after-on-prototype");
  let count = 0;
  const p = {};
  p.next = function () { return { done: ++count > 2, value: count } };
  const o = Object.create(p);
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread stored-after-on-prototype-late");
  let count = 0;
  const p = { x: 1 };
  const o = Object.create(p);
  p.next = function () { return { done: ++count > 2, value: count } };
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread stored-after-on-instance");
  let count = 0;
  class C { x = 1; }
  const o = new C();
  o.next = function () { return { done: ++count > 2, value: count } };
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread stored-on-class-prototype");
  let count = 0;
  class C { x = 1; }
  C.prototype.next = function () { return { done: ++count > 2, value: count } };
  const o = new C();
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread constructor-function");
  let count = 0;
  function F() {}
  F.prototype.next = function () { return { done: ++count > 2, value: count } };
  const o = new F();
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread constructor-function-prototype-object");
  let count = 0;
  function F() {}
  F.prototype = { next() { return { done: ++count > 2, value: count } } };
  const o = new F();
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread constructor-function-this");
  let count = 0;
  function F() { this.next = function () { return { done: ++count > 2, value: count } }; }
  const o = new F();
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread getter");
  let count = 0;
  const o = { get next() { return function () { return { done: ++count > 2, value: count } }; } };
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread defined");
  let count = 0;
  const o = {};
  Object.defineProperty(o, "next", { value: function () { return { done: ++count > 2, value: count } } });
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread assigned");
  let count = 0;
  const o = Object.assign({}, { next() { return { done: ++count > 2, value: count } } });
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread spread-copy");
  let count = 0;
  const o = { ...{ next() { return { done: ++count > 2, value: count } } } };
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread made-in-function");
  let count = 0;
  function make() { return { next() { return { done: ++count > 2, value: count } } }; }
  const o = make();
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread made-in-function-twice");
  let count = 0;
  function make() { return { next() { return { done: ++count > 2, value: count } } }; }
  make();
  const o = make();
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread literal-arrow");
  let count = 0;
  const o = { next: () => { return { done: ++count > 2, value: count } } };
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread class-field-arrow");
  let count = 0;
  class C { next = () => { return { done: ++count > 2, value: count } }; }
  const o = new C();
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("next-spread prototype-create-arrow");
  let count = 0;
  const p = { next: () => { return { done: ++count > 2, value: count } } };
  const o = Object.create(p);
  const it = { [Symbol.iterator]() { return o; } }; print([...it].length);
}
{
  const print = printer("return-break literal");
  const o = { return() { print("closed"); return {} } };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break literal-function");
  const o = { return: function () { print("closed"); return {} } };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break literal-with-field");
  const o = { x: 1, return() { print("closed"); return {} } };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break class-method");
  class C { return() { print("closed"); return {} } }
  const o = new C();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break class-field");
  class C { return = function () { print("closed"); return {} }; }
  const o = new C();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break subclass");
  class B { return() { print("closed"); return {} } }
  class C extends B {}
  const o = new C();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break class-static");
  class C { static return() { print("closed"); return {} } }
  const o = C;
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break prototype-create");
  const p = { return() { print("closed"); return {} } };
  const o = Object.create(p);
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break prototype-literal");
  const p = { return() { print("closed"); return {} } };
  const o = { __proto__: p };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break prototype-literal-with-field");
  const p = { return() { print("closed"); return {} } };
  const o = { __proto__: p, x: 1 };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break prototype-set");
  const p = { return() { print("closed"); return {} } };
  const o = {};
  Object.setPrototypeOf(o, p);
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break prototype-set-with-field");
  const p = { return() { print("closed"); return {} } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break prototype-reflect-set");
  const p = { return() { print("closed"); return {} } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break prototype-proto-store");
  const p = { return() { print("closed"); return {} } };
  const o = { x: 1 };
  o.__proto__ = p;
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break prototype-two-levels");
  const p = { return() { print("closed"); return {} } };
  const o = Object.create(Object.create(p));
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break prototype-of-class-instance");
  const p = { return() { print("closed"); return {} } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break prototype-is-instance");
  class C { return = function () { print("closed"); return {} }; }
  const o = Object.create(new C());
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break stored-after");
  const o = {};
  o.return = function () { print("closed"); return {} };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break stored-after-with-field");
  const o = { x: 1 };
  o.return = function () { print("closed"); return {} };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break stored-after-on-prototype");
  const p = {};
  p.return = function () { print("closed"); return {} };
  const o = Object.create(p);
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.return = function () { print("closed"); return {} };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.return = function () { print("closed"); return {} };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.return = function () { print("closed"); return {} };
  const o = new C();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break constructor-function");
  function F() {}
  F.prototype.return = function () { print("closed"); return {} };
  const o = new F();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break constructor-function-prototype-object");
  function F() {}
  F.prototype = { return() { print("closed"); return {} } };
  const o = new F();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break constructor-function-this");
  function F() { this.return = function () { print("closed"); return {} }; }
  const o = new F();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break getter");
  const o = { get return() { return function () { print("closed"); return {} }; } };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break defined");
  const o = {};
  Object.defineProperty(o, "return", { value: function () { print("closed"); return {} } });
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break assigned");
  const o = Object.assign({}, { return() { print("closed"); return {} } });
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break spread-copy");
  const o = { ...{ return() { print("closed"); return {} } } };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break made-in-function");
  function make() { return { return() { print("closed"); return {} } }; }
  const o = make();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break made-in-function-twice");
  function make() { return { return() { print("closed"); return {} } }; }
  make();
  const o = make();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break literal-arrow");
  const o = { return: () => { print("closed"); return {} } };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break class-field-arrow");
  class C { return = () => { print("closed"); return {} }; }
  const o = new C();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-break prototype-create-arrow");
  const p = { return: () => { print("closed"); return {} } };
  const o = Object.create(p);
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; for (const x of it) { print(x); break; }
}
{
  const print = printer("return-pattern literal");
  const o = { return() { print("closed"); return {} } };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern literal-function");
  const o = { return: function () { print("closed"); return {} } };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern literal-with-field");
  const o = { x: 1, return() { print("closed"); return {} } };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern class-method");
  class C { return() { print("closed"); return {} } }
  const o = new C();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern class-field");
  class C { return = function () { print("closed"); return {} }; }
  const o = new C();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern subclass");
  class B { return() { print("closed"); return {} } }
  class C extends B {}
  const o = new C();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern class-static");
  class C { static return() { print("closed"); return {} } }
  const o = C;
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern prototype-create");
  const p = { return() { print("closed"); return {} } };
  const o = Object.create(p);
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern prototype-literal");
  const p = { return() { print("closed"); return {} } };
  const o = { __proto__: p };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern prototype-literal-with-field");
  const p = { return() { print("closed"); return {} } };
  const o = { __proto__: p, x: 1 };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern prototype-set");
  const p = { return() { print("closed"); return {} } };
  const o = {};
  Object.setPrototypeOf(o, p);
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern prototype-set-with-field");
  const p = { return() { print("closed"); return {} } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern prototype-reflect-set");
  const p = { return() { print("closed"); return {} } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern prototype-proto-store");
  const p = { return() { print("closed"); return {} } };
  const o = { x: 1 };
  o.__proto__ = p;
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern prototype-two-levels");
  const p = { return() { print("closed"); return {} } };
  const o = Object.create(Object.create(p));
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern prototype-of-class-instance");
  const p = { return() { print("closed"); return {} } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern prototype-is-instance");
  class C { return = function () { print("closed"); return {} }; }
  const o = Object.create(new C());
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern stored-after");
  const o = {};
  o.return = function () { print("closed"); return {} };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern stored-after-with-field");
  const o = { x: 1 };
  o.return = function () { print("closed"); return {} };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern stored-after-on-prototype");
  const p = {};
  p.return = function () { print("closed"); return {} };
  const o = Object.create(p);
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.return = function () { print("closed"); return {} };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.return = function () { print("closed"); return {} };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.return = function () { print("closed"); return {} };
  const o = new C();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern constructor-function");
  function F() {}
  F.prototype.return = function () { print("closed"); return {} };
  const o = new F();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern constructor-function-prototype-object");
  function F() {}
  F.prototype = { return() { print("closed"); return {} } };
  const o = new F();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern constructor-function-this");
  function F() { this.return = function () { print("closed"); return {} }; }
  const o = new F();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern getter");
  const o = { get return() { return function () { print("closed"); return {} }; } };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern defined");
  const o = {};
  Object.defineProperty(o, "return", { value: function () { print("closed"); return {} } });
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern assigned");
  const o = Object.assign({}, { return() { print("closed"); return {} } });
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern spread-copy");
  const o = { ...{ return() { print("closed"); return {} } } };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern made-in-function");
  function make() { return { return() { print("closed"); return {} } }; }
  const o = make();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern made-in-function-twice");
  function make() { return { return() { print("closed"); return {} } }; }
  make();
  const o = make();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern literal-arrow");
  const o = { return: () => { print("closed"); return {} } };
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern class-field-arrow");
  class C { return = () => { print("closed"); return {} }; }
  const o = new C();
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}
{
  const print = printer("return-pattern prototype-create-arrow");
  const p = { return: () => { print("closed"); return {} } };
  const o = Object.create(p);
  o.next = function () { return { done: false, value: 1 }; }; const it = { [Symbol.iterator]() { return o; } }; const [a] = it; print(a);
}

console.log(lines.join("\n"));
