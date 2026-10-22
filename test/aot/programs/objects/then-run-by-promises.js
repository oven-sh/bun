// then is run by await, Promise.resolve and the result of an async function, wherever the object got it from.
const lines = [];
function printer(label) {
  return (...values) => {
    let text = label + ":";
    for (let i = 0; i < values.length; i++) text += " " + String(values[i]);
    lines.push(text);
  };
}

{
  const print = printer("then-await literal");
  const o = { then(resolve) { resolve(9) } };
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await literal-function");
  const o = { then: function (resolve) { resolve(9) } };
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await literal-with-field");
  const o = { x: 1, then(resolve) { resolve(9) } };
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await class-method");
  class C { then(resolve) { resolve(9) } }
  const o = new C();
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await class-field");
  class C { then = function (resolve) { resolve(9) }; }
  const o = new C();
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await subclass");
  class B { then(resolve) { resolve(9) } }
  class C extends B {}
  const o = new C();
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await class-static");
  class C { static then(resolve) { resolve(9) } }
  const o = C;
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await prototype-create");
  const p = { then(resolve) { resolve(9) } };
  const o = Object.create(p);
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await prototype-literal");
  const p = { then(resolve) { resolve(9) } };
  const o = { __proto__: p };
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await prototype-literal-with-field");
  const p = { then(resolve) { resolve(9) } };
  const o = { __proto__: p, x: 1 };
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await prototype-set");
  const p = { then(resolve) { resolve(9) } };
  const o = {};
  Object.setPrototypeOf(o, p);
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await prototype-set-with-field");
  const p = { then(resolve) { resolve(9) } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await prototype-reflect-set");
  const p = { then(resolve) { resolve(9) } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await prototype-proto-store");
  const p = { then(resolve) { resolve(9) } };
  const o = { x: 1 };
  o.__proto__ = p;
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await prototype-two-levels");
  const p = { then(resolve) { resolve(9) } };
  const o = Object.create(Object.create(p));
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await prototype-of-class-instance");
  const p = { then(resolve) { resolve(9) } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await prototype-is-instance");
  class C { then = function (resolve) { resolve(9) }; }
  const o = Object.create(new C());
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await stored-after");
  const o = {};
  o.then = function (resolve) { resolve(9) };
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await stored-after-with-field");
  const o = { x: 1 };
  o.then = function (resolve) { resolve(9) };
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await stored-after-on-prototype");
  const p = {};
  p.then = function (resolve) { resolve(9) };
  const o = Object.create(p);
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.then = function (resolve) { resolve(9) };
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.then = function (resolve) { resolve(9) };
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.then = function (resolve) { resolve(9) };
  const o = new C();
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await constructor-function");
  function F() {}
  F.prototype.then = function (resolve) { resolve(9) };
  const o = new F();
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await constructor-function-prototype-object");
  function F() {}
  F.prototype = { then(resolve) { resolve(9) } };
  const o = new F();
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await constructor-function-this");
  function F() { this.then = function (resolve) { resolve(9) }; }
  const o = new F();
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await getter");
  const o = { get then() { return function (resolve) { resolve(9) }; } };
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await defined");
  const o = {};
  Object.defineProperty(o, "then", { value: function (resolve) { resolve(9) } });
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await assigned");
  const o = Object.assign({}, { then(resolve) { resolve(9) } });
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await spread-copy");
  const o = { ...{ then(resolve) { resolve(9) } } };
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await made-in-function");
  function make() { return { then(resolve) { resolve(9) } }; }
  const o = make();
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await made-in-function-twice");
  function make() { return { then(resolve) { resolve(9) } }; }
  make();
  const o = make();
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await literal-arrow");
  const o = { then: (resolve) => { resolve(9) } };
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await class-field-arrow");
  class C { then = (resolve) => { resolve(9) }; }
  const o = new C();
  async function main() { print(await o); } main();
}
{
  const print = printer("then-await prototype-create-arrow");
  const p = { then: (resolve) => { resolve(9) } };
  const o = Object.create(p);
  async function main() { print(await o); } main();
}
{
  const print = printer("then-resolve literal");
  const o = { then(resolve) { resolve(9) } };
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve literal-function");
  const o = { then: function (resolve) { resolve(9) } };
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve literal-with-field");
  const o = { x: 1, then(resolve) { resolve(9) } };
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve class-method");
  class C { then(resolve) { resolve(9) } }
  const o = new C();
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve class-field");
  class C { then = function (resolve) { resolve(9) }; }
  const o = new C();
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve subclass");
  class B { then(resolve) { resolve(9) } }
  class C extends B {}
  const o = new C();
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve class-static");
  class C { static then(resolve) { resolve(9) } }
  const o = C;
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve prototype-create");
  const p = { then(resolve) { resolve(9) } };
  const o = Object.create(p);
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve prototype-literal");
  const p = { then(resolve) { resolve(9) } };
  const o = { __proto__: p };
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve prototype-literal-with-field");
  const p = { then(resolve) { resolve(9) } };
  const o = { __proto__: p, x: 1 };
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve prototype-set");
  const p = { then(resolve) { resolve(9) } };
  const o = {};
  Object.setPrototypeOf(o, p);
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve prototype-set-with-field");
  const p = { then(resolve) { resolve(9) } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve prototype-reflect-set");
  const p = { then(resolve) { resolve(9) } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve prototype-proto-store");
  const p = { then(resolve) { resolve(9) } };
  const o = { x: 1 };
  o.__proto__ = p;
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve prototype-two-levels");
  const p = { then(resolve) { resolve(9) } };
  const o = Object.create(Object.create(p));
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve prototype-of-class-instance");
  const p = { then(resolve) { resolve(9) } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve prototype-is-instance");
  class C { then = function (resolve) { resolve(9) }; }
  const o = Object.create(new C());
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve stored-after");
  const o = {};
  o.then = function (resolve) { resolve(9) };
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve stored-after-with-field");
  const o = { x: 1 };
  o.then = function (resolve) { resolve(9) };
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve stored-after-on-prototype");
  const p = {};
  p.then = function (resolve) { resolve(9) };
  const o = Object.create(p);
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.then = function (resolve) { resolve(9) };
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.then = function (resolve) { resolve(9) };
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.then = function (resolve) { resolve(9) };
  const o = new C();
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve constructor-function");
  function F() {}
  F.prototype.then = function (resolve) { resolve(9) };
  const o = new F();
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve constructor-function-prototype-object");
  function F() {}
  F.prototype = { then(resolve) { resolve(9) } };
  const o = new F();
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve constructor-function-this");
  function F() { this.then = function (resolve) { resolve(9) }; }
  const o = new F();
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve getter");
  const o = { get then() { return function (resolve) { resolve(9) }; } };
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve defined");
  const o = {};
  Object.defineProperty(o, "then", { value: function (resolve) { resolve(9) } });
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve assigned");
  const o = Object.assign({}, { then(resolve) { resolve(9) } });
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve spread-copy");
  const o = { ...{ then(resolve) { resolve(9) } } };
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve made-in-function");
  function make() { return { then(resolve) { resolve(9) } }; }
  const o = make();
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve made-in-function-twice");
  function make() { return { then(resolve) { resolve(9) } }; }
  make();
  const o = make();
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve literal-arrow");
  const o = { then: (resolve) => { resolve(9) } };
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve class-field-arrow");
  class C { then = (resolve) => { resolve(9) }; }
  const o = new C();
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-resolve prototype-create-arrow");
  const p = { then: (resolve) => { resolve(9) } };
  const o = Object.create(p);
  Promise.resolve(o).then(print);
}
{
  const print = printer("then-async-return literal");
  const o = { then(resolve) { resolve(9) } };
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return literal-function");
  const o = { then: function (resolve) { resolve(9) } };
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return literal-with-field");
  const o = { x: 1, then(resolve) { resolve(9) } };
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return class-method");
  class C { then(resolve) { resolve(9) } }
  const o = new C();
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return class-field");
  class C { then = function (resolve) { resolve(9) }; }
  const o = new C();
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return subclass");
  class B { then(resolve) { resolve(9) } }
  class C extends B {}
  const o = new C();
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return class-static");
  class C { static then(resolve) { resolve(9) } }
  const o = C;
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return prototype-create");
  const p = { then(resolve) { resolve(9) } };
  const o = Object.create(p);
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return prototype-literal");
  const p = { then(resolve) { resolve(9) } };
  const o = { __proto__: p };
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return prototype-literal-with-field");
  const p = { then(resolve) { resolve(9) } };
  const o = { __proto__: p, x: 1 };
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return prototype-set");
  const p = { then(resolve) { resolve(9) } };
  const o = {};
  Object.setPrototypeOf(o, p);
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return prototype-set-with-field");
  const p = { then(resolve) { resolve(9) } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return prototype-reflect-set");
  const p = { then(resolve) { resolve(9) } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return prototype-proto-store");
  const p = { then(resolve) { resolve(9) } };
  const o = { x: 1 };
  o.__proto__ = p;
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return prototype-two-levels");
  const p = { then(resolve) { resolve(9) } };
  const o = Object.create(Object.create(p));
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return prototype-of-class-instance");
  const p = { then(resolve) { resolve(9) } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return prototype-is-instance");
  class C { then = function (resolve) { resolve(9) }; }
  const o = Object.create(new C());
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return stored-after");
  const o = {};
  o.then = function (resolve) { resolve(9) };
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return stored-after-with-field");
  const o = { x: 1 };
  o.then = function (resolve) { resolve(9) };
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return stored-after-on-prototype");
  const p = {};
  p.then = function (resolve) { resolve(9) };
  const o = Object.create(p);
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.then = function (resolve) { resolve(9) };
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.then = function (resolve) { resolve(9) };
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.then = function (resolve) { resolve(9) };
  const o = new C();
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return constructor-function");
  function F() {}
  F.prototype.then = function (resolve) { resolve(9) };
  const o = new F();
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return constructor-function-prototype-object");
  function F() {}
  F.prototype = { then(resolve) { resolve(9) } };
  const o = new F();
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return constructor-function-this");
  function F() { this.then = function (resolve) { resolve(9) }; }
  const o = new F();
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return getter");
  const o = { get then() { return function (resolve) { resolve(9) }; } };
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return defined");
  const o = {};
  Object.defineProperty(o, "then", { value: function (resolve) { resolve(9) } });
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return assigned");
  const o = Object.assign({}, { then(resolve) { resolve(9) } });
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return spread-copy");
  const o = { ...{ then(resolve) { resolve(9) } } };
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return made-in-function");
  function make() { return { then(resolve) { resolve(9) } }; }
  const o = make();
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return made-in-function-twice");
  function make() { return { then(resolve) { resolve(9) } }; }
  make();
  const o = make();
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return literal-arrow");
  const o = { then: (resolve) => { resolve(9) } };
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return class-field-arrow");
  class C { then = (resolve) => { resolve(9) }; }
  const o = new C();
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-async-return prototype-create-arrow");
  const p = { then: (resolve) => { resolve(9) } };
  const o = Object.create(p);
  async function f() { return o; } f().then(print);
}
{
  const print = printer("then-then-result literal");
  const o = { then(resolve) { resolve(9) } };
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result literal-function");
  const o = { then: function (resolve) { resolve(9) } };
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result literal-with-field");
  const o = { x: 1, then(resolve) { resolve(9) } };
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result class-method");
  class C { then(resolve) { resolve(9) } }
  const o = new C();
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result class-field");
  class C { then = function (resolve) { resolve(9) }; }
  const o = new C();
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result subclass");
  class B { then(resolve) { resolve(9) } }
  class C extends B {}
  const o = new C();
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result class-static");
  class C { static then(resolve) { resolve(9) } }
  const o = C;
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result prototype-create");
  const p = { then(resolve) { resolve(9) } };
  const o = Object.create(p);
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result prototype-literal");
  const p = { then(resolve) { resolve(9) } };
  const o = { __proto__: p };
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result prototype-literal-with-field");
  const p = { then(resolve) { resolve(9) } };
  const o = { __proto__: p, x: 1 };
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result prototype-set");
  const p = { then(resolve) { resolve(9) } };
  const o = {};
  Object.setPrototypeOf(o, p);
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result prototype-set-with-field");
  const p = { then(resolve) { resolve(9) } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result prototype-reflect-set");
  const p = { then(resolve) { resolve(9) } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result prototype-proto-store");
  const p = { then(resolve) { resolve(9) } };
  const o = { x: 1 };
  o.__proto__ = p;
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result prototype-two-levels");
  const p = { then(resolve) { resolve(9) } };
  const o = Object.create(Object.create(p));
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result prototype-of-class-instance");
  const p = { then(resolve) { resolve(9) } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result prototype-is-instance");
  class C { then = function (resolve) { resolve(9) }; }
  const o = Object.create(new C());
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result stored-after");
  const o = {};
  o.then = function (resolve) { resolve(9) };
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result stored-after-with-field");
  const o = { x: 1 };
  o.then = function (resolve) { resolve(9) };
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result stored-after-on-prototype");
  const p = {};
  p.then = function (resolve) { resolve(9) };
  const o = Object.create(p);
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p.then = function (resolve) { resolve(9) };
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o.then = function (resolve) { resolve(9) };
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.then = function (resolve) { resolve(9) };
  const o = new C();
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result constructor-function");
  function F() {}
  F.prototype.then = function (resolve) { resolve(9) };
  const o = new F();
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result constructor-function-prototype-object");
  function F() {}
  F.prototype = { then(resolve) { resolve(9) } };
  const o = new F();
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result constructor-function-this");
  function F() { this.then = function (resolve) { resolve(9) }; }
  const o = new F();
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result getter");
  const o = { get then() { return function (resolve) { resolve(9) }; } };
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result defined");
  const o = {};
  Object.defineProperty(o, "then", { value: function (resolve) { resolve(9) } });
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result assigned");
  const o = Object.assign({}, { then(resolve) { resolve(9) } });
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result spread-copy");
  const o = { ...{ then(resolve) { resolve(9) } } };
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result made-in-function");
  function make() { return { then(resolve) { resolve(9) } }; }
  const o = make();
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result made-in-function-twice");
  function make() { return { then(resolve) { resolve(9) } }; }
  make();
  const o = make();
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result literal-arrow");
  const o = { then: (resolve) => { resolve(9) } };
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result class-field-arrow");
  class C { then = (resolve) => { resolve(9) }; }
  const o = new C();
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("then-then-result prototype-create-arrow");
  const p = { then: (resolve) => { resolve(9) } };
  const o = Object.create(p);
  Promise.resolve(1).then(() => o).then(print);
}
{
  const print = printer("async-iterator literal");
  const o = { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator literal-function");
  const o = { [Symbol.asyncIterator]: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator literal-with-field");
  const o = { x: 1, [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator class-method");
  class C { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } }
  const o = new C();
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator class-field");
  class C { [Symbol.asyncIterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } }; }
  const o = new C();
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator subclass");
  class B { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } }
  class C extends B {}
  const o = new C();
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator class-static");
  class C { static [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } }
  const o = C;
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator prototype-create");
  const p = { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  const o = Object.create(p);
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator prototype-literal");
  const p = { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  const o = { __proto__: p };
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator prototype-literal-with-field");
  const p = { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  const o = { __proto__: p, x: 1 };
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator prototype-set");
  const p = { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  const o = {};
  Object.setPrototypeOf(o, p);
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator prototype-set-with-field");
  const p = { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator prototype-reflect-set");
  const p = { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  const o = { x: 1 };
  Reflect.setPrototypeOf(o, p);
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator prototype-proto-store");
  const p = { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  const o = { x: 1 };
  o.__proto__ = p;
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator prototype-two-levels");
  const p = { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  const o = Object.create(Object.create(p));
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator prototype-of-class-instance");
  const p = { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  class C { x = 1; }
  Object.setPrototypeOf(C.prototype, p);
  const o = new C();
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator prototype-is-instance");
  class C { [Symbol.asyncIterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } }; }
  const o = Object.create(new C());
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator stored-after");
  const o = {};
  o[Symbol.asyncIterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } };
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator stored-after-with-field");
  const o = { x: 1 };
  o[Symbol.asyncIterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } };
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator stored-after-on-prototype");
  const p = {};
  p[Symbol.asyncIterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } };
  const o = Object.create(p);
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator stored-after-on-prototype-late");
  const p = { x: 1 };
  const o = Object.create(p);
  p[Symbol.asyncIterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } };
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator stored-after-on-instance");
  class C { x = 1; }
  const o = new C();
  o[Symbol.asyncIterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } };
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator stored-on-class-prototype");
  class C { x = 1; }
  C.prototype[Symbol.asyncIterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } };
  const o = new C();
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator constructor-function");
  function F() {}
  F.prototype[Symbol.asyncIterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } };
  const o = new F();
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator constructor-function-prototype-object");
  function F() {}
  F.prototype = { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  const o = new F();
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator constructor-function-this");
  function F() { this[Symbol.asyncIterator] = function () { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } }; }
  const o = new F();
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator getter");
  const o = { get [Symbol.asyncIterator]() { return function () { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } }; } };
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator defined");
  const o = {};
  Object.defineProperty(o, Symbol.asyncIterator, { value: function () { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } });
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator assigned");
  const o = Object.assign({}, { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } });
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator spread-copy");
  const o = { ...{ [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } } };
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator made-in-function");
  function make() { return { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } }; }
  const o = make();
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator made-in-function-twice");
  function make() { return { [Symbol.asyncIterator]() { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } }; }
  make();
  const o = make();
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator literal-arrow");
  const o = { [Symbol.asyncIterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator class-field-arrow");
  class C { [Symbol.asyncIterator] = () => { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } }; }
  const o = new C();
  async function main() { for await (const x of o) print(x); } main();
}
{
  const print = printer("async-iterator prototype-create-arrow");
  const p = { [Symbol.asyncIterator]: () => { let i = 0; return { next() { return { done: i >= 2, value: i++ }; } } } };
  const o = Object.create(p);
  async function main() { for await (const x of o) print(x); } main();
}

await new Promise(resolve => setTimeout(resolve, 0));
console.log(lines.join("\n"));
