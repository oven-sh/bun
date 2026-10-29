// RUN: lower
// OPTIONS: builtin-modules

// A field that no access names is still read, listed or tested by built-ins, loops and spreads, wherever the object got it from.
const lines = [];
function printer(label) {
  return (...values) => {
    let text = label + ":";
    for (let i = 0; i < values.length; i++) text += " " + String(values[i]);
    lines.push(text);
  };
}

{
  const print = printer("to-string-tag literal");
  const o = { [Symbol.toStringTag]: "T" };
  print(`${o}`);
}
{
  const print = printer("to-string-tag literal-with-field");
  const o = { x: 1, [Symbol.toStringTag]: "T" };
  print(o.x);
  print(`${o}`);
}
{
  const print = printer("to-string-tag class-field");
  class C { [Symbol.toStringTag] = "T"; }
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("to-string-tag subclass-field");
  class B { [Symbol.toStringTag] = "T"; }
  class C extends B { y = 2; }
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("to-string-tag class-static");
  class C { static [Symbol.toStringTag] = "T"; }
  const o = C;
  print(Object.prototype.toString.call(o));
}
{
  const print = printer("to-string-tag prototype-create");
  const p = { [Symbol.toStringTag]: "T" };
  const o = Object.create(p);
  print(`${o}`);
}
{
  const print = printer("to-string-tag prototype-literal");
  const p = { [Symbol.toStringTag]: "T" };
  const o = { __proto__: p };
  print(`${o}`);
}
{
  const print = printer("to-string-tag prototype-set-with-field");
  const p = { [Symbol.toStringTag]: "T" };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(`${o}`);
}
{
  const print = printer("to-string-tag prototype-is-instance");
  class C { [Symbol.toStringTag] = "T"; }
  const o = Object.create(new C());
  print(`${o}`);
}
{
  const print = printer("to-string-tag stored-after");
  const o = {};
  o[Symbol.toStringTag] = "T";
  print(`${o}`);
}
{
  const print = printer("to-string-tag stored-after-with-field");
  const o = { x: 1 };
  o[Symbol.toStringTag] = "T";
  print(`${o}`);
}
{
  const print = printer("to-string-tag stored-after-on-prototype");
  const p = {};
  p[Symbol.toStringTag] = "T";
  const o = Object.create(p);
  print(`${o}`);
}
{
  const print = printer("to-string-tag constructor-function-this");
  function F() { this[Symbol.toStringTag] = "T"; }
  const o = new F();
  print(`${o}`);
}
{
  const print = printer("to-string-tag stored-on-class-prototype");
  class C { x = 1; }
  C.prototype[Symbol.toStringTag] = "T";
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("to-string-tag getter");
  const o = { get [Symbol.toStringTag]() { return "T"; } };
  print(`${o}`);
}
{
  const print = printer("to-string-tag class-getter");
  class C { get [Symbol.toStringTag]() { return "T"; } }
  const o = new C();
  print(`${o}`);
}
{
  const print = printer("to-string-tag made-in-function");
  function make() { return { [Symbol.toStringTag]: "T" }; }
  const o = make();
  print(`${o}`);
}
{
  const print = printer("apply-length literal");
  const o = { length: 1 };
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length literal-with-field");
  const o = { x: 1, length: 1 };
  print(o.x);
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length class-field");
  class C { length = 1; }
  const o = new C();
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length subclass-field");
  class B { length = 1; }
  class C extends B { y = 2; }
  const o = new C();
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length class-static");
  class C { static length = 1; }
  const o = C;
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length prototype-create");
  const p = { length: 1 };
  const o = Object.create(p);
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length prototype-literal");
  const p = { length: 1 };
  const o = { __proto__: p };
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length prototype-set-with-field");
  const p = { length: 1 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length prototype-is-instance");
  class C { length = 1; }
  const o = Object.create(new C());
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length stored-after");
  const o = {};
  o.length = 1;
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length stored-after-with-field");
  const o = { x: 1 };
  o.length = 1;
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length stored-after-on-prototype");
  const p = {};
  p.length = 1;
  const o = Object.create(p);
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length constructor-function-this");
  function F() { this.length = 1; }
  const o = new F();
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.length = 1;
  const o = new C();
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length getter");
  const o = { get length() { return 1; } };
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length class-getter");
  class C { get length() { return 1; } }
  const o = new C();
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("apply-length made-in-function");
  function make() { return { length: 1 }; }
  const o = make();
  o[0] = 65; print(String.fromCharCode.apply(null, o));
}
{
  const print = printer("descriptor-value literal");
  const o = { value: 45 };
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value literal-with-field");
  const o = { x: 1, value: 45 };
  print(o.x);
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value class-field");
  class C { value = 45; }
  const o = new C();
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value subclass-field");
  class B { value = 45; }
  class C extends B { y = 2; }
  const o = new C();
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value class-static");
  class C { static value = 45; }
  const o = C;
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value prototype-create");
  const p = { value: 45 };
  const o = Object.create(p);
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value prototype-literal");
  const p = { value: 45 };
  const o = { __proto__: p };
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value prototype-set-with-field");
  const p = { value: 45 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value prototype-is-instance");
  class C { value = 45; }
  const o = Object.create(new C());
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value stored-after");
  const o = {};
  o.value = 45;
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value stored-after-with-field");
  const o = { x: 1 };
  o.value = 45;
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value stored-after-on-prototype");
  const p = {};
  p.value = 45;
  const o = Object.create(p);
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value constructor-function-this");
  function F() { this.value = 45; }
  const o = new F();
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.value = 45;
  const o = new C();
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value getter");
  const o = { get value() { return 45; } };
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value class-getter");
  class C { get value() { return 45; } }
  const o = new C();
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-value made-in-function");
  function make() { return { value: 45 }; }
  const o = make();
  const t = {}; Object.defineProperty(t, "x", o); print(t.x);
}
{
  const print = printer("descriptor-enumerable literal");
  const o = { enumerable: true };
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable literal-with-field");
  const o = { x: 1, enumerable: true };
  print(o.x);
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable class-field");
  class C { enumerable = true; }
  const o = new C();
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable subclass-field");
  class B { enumerable = true; }
  class C extends B { y = 2; }
  const o = new C();
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable class-static");
  class C { static enumerable = true; }
  const o = C;
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable prototype-create");
  const p = { enumerable: true };
  const o = Object.create(p);
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable prototype-literal");
  const p = { enumerable: true };
  const o = { __proto__: p };
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable prototype-set-with-field");
  const p = { enumerable: true };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable prototype-is-instance");
  class C { enumerable = true; }
  const o = Object.create(new C());
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable stored-after");
  const o = {};
  o.enumerable = true;
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable stored-after-with-field");
  const o = { x: 1 };
  o.enumerable = true;
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable stored-after-on-prototype");
  const p = {};
  p.enumerable = true;
  const o = Object.create(p);
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable constructor-function-this");
  function F() { this.enumerable = true; }
  const o = new F();
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.enumerable = true;
  const o = new C();
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable getter");
  const o = { get enumerable() { return true; } };
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable class-getter");
  class C { get enumerable() { return true; } }
  const o = new C();
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-enumerable made-in-function");
  function make() { return { enumerable: true }; }
  const o = make();
  const t = {}; Object.defineProperty(t, "x", o); print(Object.keys(t).length);
}
{
  const print = printer("descriptor-writable literal");
  const o = { writable: true };
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable literal-with-field");
  const o = { x: 1, writable: true };
  print(o.x);
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable class-field");
  class C { writable = true; }
  const o = new C();
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable subclass-field");
  class B { writable = true; }
  class C extends B { y = 2; }
  const o = new C();
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable class-static");
  class C { static writable = true; }
  const o = C;
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable prototype-create");
  const p = { writable: true };
  const o = Object.create(p);
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable prototype-literal");
  const p = { writable: true };
  const o = { __proto__: p };
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable prototype-set-with-field");
  const p = { writable: true };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable prototype-is-instance");
  class C { writable = true; }
  const o = Object.create(new C());
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable stored-after");
  const o = {};
  o.writable = true;
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable stored-after-with-field");
  const o = { x: 1 };
  o.writable = true;
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable stored-after-on-prototype");
  const p = {};
  p.writable = true;
  const o = Object.create(p);
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable constructor-function-this");
  function F() { this.writable = true; }
  const o = new F();
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.writable = true;
  const o = new C();
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable getter");
  const o = { get writable() { return true; } };
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable class-getter");
  class C { get writable() { return true; } }
  const o = new C();
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("descriptor-writable made-in-function");
  function make() { return { writable: true }; }
  const o = make();
  const t = {}; Object.defineProperty(t, "x", o); t.x = 5; print(t.x);
}
{
  const print = printer("error-message literal");
  const o = { message: "M" };
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message literal-with-field");
  const o = { x: 1, message: "M" };
  print(o.x);
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message class-field");
  class C { message = "M"; }
  const o = new C();
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message subclass-field");
  class B { message = "M"; }
  class C extends B { y = 2; }
  const o = new C();
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message class-static");
  class C { static message = "M"; }
  const o = C;
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message prototype-create");
  const p = { message: "M" };
  const o = Object.create(p);
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message prototype-literal");
  const p = { message: "M" };
  const o = { __proto__: p };
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message prototype-set-with-field");
  const p = { message: "M" };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message prototype-is-instance");
  class C { message = "M"; }
  const o = Object.create(new C());
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message stored-after");
  const o = {};
  o.message = "M";
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message stored-after-with-field");
  const o = { x: 1 };
  o.message = "M";
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message stored-after-on-prototype");
  const p = {};
  p.message = "M";
  const o = Object.create(p);
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message constructor-function-this");
  function F() { this.message = "M"; }
  const o = new F();
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.message = "M";
  const o = new C();
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message getter");
  const o = { get message() { return "M"; } };
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message class-getter");
  class C { get message() { return "M"; } }
  const o = new C();
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-message made-in-function");
  function make() { return { message: "M" }; }
  const o = make();
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name literal");
  const o = { name: "N" };
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name literal-with-field");
  const o = { x: 1, name: "N" };
  print(o.x);
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name class-field");
  class C { name = "N"; }
  const o = new C();
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name subclass-field");
  class B { name = "N"; }
  class C extends B { y = 2; }
  const o = new C();
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name class-static");
  class C { static name = "N"; }
  const o = C;
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name prototype-create");
  const p = { name: "N" };
  const o = Object.create(p);
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name prototype-literal");
  const p = { name: "N" };
  const o = { __proto__: p };
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name prototype-set-with-field");
  const p = { name: "N" };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name prototype-is-instance");
  class C { name = "N"; }
  const o = Object.create(new C());
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name stored-after");
  const o = {};
  o.name = "N";
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name stored-after-with-field");
  const o = { x: 1 };
  o.name = "N";
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name stored-after-on-prototype");
  const p = {};
  p.name = "N";
  const o = Object.create(p);
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name constructor-function-this");
  function F() { this.name = "N"; }
  const o = new F();
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.name = "N";
  const o = new C();
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name getter");
  const o = { get name() { return "N"; } };
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name class-getter");
  class C { get name() { return "N"; } }
  const o = new C();
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-name made-in-function");
  function make() { return { name: "N" }; }
  const o = make();
  o.toString = Error.prototype.toString; print(`${o}`);
}
{
  const print = printer("error-cause literal");
  const o = { cause: 46 };
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause literal-with-field");
  const o = { x: 1, cause: 46 };
  print(o.x);
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause class-field");
  class C { cause = 46; }
  const o = new C();
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause subclass-field");
  class B { cause = 46; }
  class C extends B { y = 2; }
  const o = new C();
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause class-static");
  class C { static cause = 46; }
  const o = C;
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause prototype-create");
  const p = { cause: 46 };
  const o = Object.create(p);
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause prototype-literal");
  const p = { cause: 46 };
  const o = { __proto__: p };
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause prototype-set-with-field");
  const p = { cause: 46 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause prototype-is-instance");
  class C { cause = 46; }
  const o = Object.create(new C());
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause stored-after");
  const o = {};
  o.cause = 46;
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause stored-after-with-field");
  const o = { x: 1 };
  o.cause = 46;
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause stored-after-on-prototype");
  const p = {};
  p.cause = 46;
  const o = Object.create(p);
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause constructor-function-this");
  function F() { this.cause = 46; }
  const o = new F();
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.cause = 46;
  const o = new C();
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause getter");
  const o = { get cause() { return 46; } };
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause class-getter");
  class C { get cause() { return 46; } }
  const o = new C();
  print(new Error("x", o).cause);
}
{
  const print = printer("error-cause made-in-function");
  function make() { return { cause: 46 }; }
  const o = make();
  print(new Error("x", o).cause);
}
{
  const print = printer("stringify literal");
  const o = { a: 1 };
  print(JSON.stringify(o));
}
{
  const print = printer("stringify literal-with-field");
  const o = { x: 1, a: 1 };
  print(o.x);
  print(JSON.stringify(o));
}
{
  const print = printer("stringify class-field");
  class C { a = 1; }
  const o = new C();
  print(JSON.stringify(o));
}
{
  const print = printer("stringify subclass-field");
  class B { a = 1; }
  class C extends B { y = 2; }
  const o = new C();
  print(JSON.stringify(o));
}
{
  const print = printer("stringify class-static");
  class C { static a = 1; }
  const o = C;
  print(JSON.stringify(o));
}
{
  const print = printer("stringify prototype-create");
  const p = { a: 1 };
  const o = Object.create(p);
  print(JSON.stringify(o));
}
{
  const print = printer("stringify prototype-literal");
  const p = { a: 1 };
  const o = { __proto__: p };
  print(JSON.stringify(o));
}
{
  const print = printer("stringify prototype-set-with-field");
  const p = { a: 1 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(JSON.stringify(o));
}
{
  const print = printer("stringify prototype-is-instance");
  class C { a = 1; }
  const o = Object.create(new C());
  print(JSON.stringify(o));
}
{
  const print = printer("stringify stored-after");
  const o = {};
  o.a = 1;
  print(JSON.stringify(o));
}
{
  const print = printer("stringify stored-after-with-field");
  const o = { x: 1 };
  o.a = 1;
  print(JSON.stringify(o));
}
{
  const print = printer("stringify stored-after-on-prototype");
  const p = {};
  p.a = 1;
  const o = Object.create(p);
  print(JSON.stringify(o));
}
{
  const print = printer("stringify constructor-function-this");
  function F() { this.a = 1; }
  const o = new F();
  print(JSON.stringify(o));
}
{
  const print = printer("stringify stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.a = 1;
  const o = new C();
  print(JSON.stringify(o));
}
{
  const print = printer("stringify getter");
  const o = { get a() { return 1; } };
  print(JSON.stringify(o));
}
{
  const print = printer("stringify class-getter");
  class C { get a() { return 1; } }
  const o = new C();
  print(JSON.stringify(o));
}
{
  const print = printer("stringify made-in-function");
  function make() { return { a: 1 }; }
  const o = make();
  print(JSON.stringify(o));
}
{
  const print = printer("spread literal");
  const o = { a: 1 };
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread literal-with-field");
  const o = { x: 1, a: 1 };
  print(o.x);
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread class-field");
  class C { a = 1; }
  const o = new C();
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread subclass-field");
  class B { a = 1; }
  class C extends B { y = 2; }
  const o = new C();
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread class-static");
  class C { static a = 1; }
  const o = C;
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread prototype-create");
  const p = { a: 1 };
  const o = Object.create(p);
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread prototype-literal");
  const p = { a: 1 };
  const o = { __proto__: p };
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread prototype-set-with-field");
  const p = { a: 1 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread prototype-is-instance");
  class C { a = 1; }
  const o = Object.create(new C());
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread stored-after");
  const o = {};
  o.a = 1;
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread stored-after-with-field");
  const o = { x: 1 };
  o.a = 1;
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread stored-after-on-prototype");
  const p = {};
  p.a = 1;
  const o = Object.create(p);
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread constructor-function-this");
  function F() { this.a = 1; }
  const o = new F();
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.a = 1;
  const o = new C();
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread getter");
  const o = { get a() { return 1; } };
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread class-getter");
  class C { get a() { return 1; } }
  const o = new C();
  const c = { ...o }; print(c.a);
}
{
  const print = printer("spread made-in-function");
  function make() { return { a: 1 }; }
  const o = make();
  const c = { ...o }; print(c.a);
}
{
  const print = printer("assign literal");
  const o = { a: 1 };
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign literal-with-field");
  const o = { x: 1, a: 1 };
  print(o.x);
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign class-field");
  class C { a = 1; }
  const o = new C();
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign subclass-field");
  class B { a = 1; }
  class C extends B { y = 2; }
  const o = new C();
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign class-static");
  class C { static a = 1; }
  const o = C;
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign prototype-create");
  const p = { a: 1 };
  const o = Object.create(p);
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign prototype-literal");
  const p = { a: 1 };
  const o = { __proto__: p };
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign prototype-set-with-field");
  const p = { a: 1 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign prototype-is-instance");
  class C { a = 1; }
  const o = Object.create(new C());
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign stored-after");
  const o = {};
  o.a = 1;
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign stored-after-with-field");
  const o = { x: 1 };
  o.a = 1;
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign stored-after-on-prototype");
  const p = {};
  p.a = 1;
  const o = Object.create(p);
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign constructor-function-this");
  function F() { this.a = 1; }
  const o = new F();
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.a = 1;
  const o = new C();
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign getter");
  const o = { get a() { return 1; } };
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign class-getter");
  class C { get a() { return 1; } }
  const o = new C();
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("assign made-in-function");
  function make() { return { a: 1 }; }
  const o = make();
  const c = Object.assign({}, o); print(c.a);
}
{
  const print = printer("for-in literal");
  const o = { a: 1 };
  for (const k in o) print(k);
}
{
  const print = printer("for-in literal-with-field");
  const o = { x: 1, a: 1 };
  print(o.x);
  for (const k in o) print(k);
}
{
  const print = printer("for-in class-field");
  class C { a = 1; }
  const o = new C();
  for (const k in o) print(k);
}
{
  const print = printer("for-in subclass-field");
  class B { a = 1; }
  class C extends B { y = 2; }
  const o = new C();
  for (const k in o) print(k);
}
{
  const print = printer("for-in class-static");
  class C { static a = 1; }
  const o = C;
  for (const k in o) print(k);
}
{
  const print = printer("for-in prototype-create");
  const p = { a: 1 };
  const o = Object.create(p);
  for (const k in o) print(k);
}
{
  const print = printer("for-in prototype-literal");
  const p = { a: 1 };
  const o = { __proto__: p };
  for (const k in o) print(k);
}
{
  const print = printer("for-in prototype-set-with-field");
  const p = { a: 1 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  for (const k in o) print(k);
}
{
  const print = printer("for-in prototype-is-instance");
  class C { a = 1; }
  const o = Object.create(new C());
  for (const k in o) print(k);
}
{
  const print = printer("for-in stored-after");
  const o = {};
  o.a = 1;
  for (const k in o) print(k);
}
{
  const print = printer("for-in stored-after-with-field");
  const o = { x: 1 };
  o.a = 1;
  for (const k in o) print(k);
}
{
  const print = printer("for-in stored-after-on-prototype");
  const p = {};
  p.a = 1;
  const o = Object.create(p);
  for (const k in o) print(k);
}
{
  const print = printer("for-in constructor-function-this");
  function F() { this.a = 1; }
  const o = new F();
  for (const k in o) print(k);
}
{
  const print = printer("for-in stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.a = 1;
  const o = new C();
  for (const k in o) print(k);
}
{
  const print = printer("for-in getter");
  const o = { get a() { return 1; } };
  for (const k in o) print(k);
}
{
  const print = printer("for-in class-getter");
  class C { get a() { return 1; } }
  const o = new C();
  for (const k in o) print(k);
}
{
  const print = printer("for-in made-in-function");
  function make() { return { a: 1 }; }
  const o = make();
  for (const k in o) print(k);
}
{
  const print = printer("keys literal");
  const o = { a: 1 };
  print(Object.keys(o).length);
}
{
  const print = printer("keys literal-with-field");
  const o = { x: 1, a: 1 };
  print(o.x);
  print(Object.keys(o).length);
}
{
  const print = printer("keys class-field");
  class C { a = 1; }
  const o = new C();
  print(Object.keys(o).length);
}
{
  const print = printer("keys subclass-field");
  class B { a = 1; }
  class C extends B { y = 2; }
  const o = new C();
  print(Object.keys(o).length);
}
{
  const print = printer("keys class-static");
  class C { static a = 1; }
  const o = C;
  print(Object.keys(o).length);
}
{
  const print = printer("keys prototype-create");
  const p = { a: 1 };
  const o = Object.create(p);
  print(Object.keys(o).length);
}
{
  const print = printer("keys prototype-literal");
  const p = { a: 1 };
  const o = { __proto__: p };
  print(Object.keys(o).length);
}
{
  const print = printer("keys prototype-set-with-field");
  const p = { a: 1 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(Object.keys(o).length);
}
{
  const print = printer("keys prototype-is-instance");
  class C { a = 1; }
  const o = Object.create(new C());
  print(Object.keys(o).length);
}
{
  const print = printer("keys stored-after");
  const o = {};
  o.a = 1;
  print(Object.keys(o).length);
}
{
  const print = printer("keys stored-after-with-field");
  const o = { x: 1 };
  o.a = 1;
  print(Object.keys(o).length);
}
{
  const print = printer("keys stored-after-on-prototype");
  const p = {};
  p.a = 1;
  const o = Object.create(p);
  print(Object.keys(o).length);
}
{
  const print = printer("keys constructor-function-this");
  function F() { this.a = 1; }
  const o = new F();
  print(Object.keys(o).length);
}
{
  const print = printer("keys stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.a = 1;
  const o = new C();
  print(Object.keys(o).length);
}
{
  const print = printer("keys getter");
  const o = { get a() { return 1; } };
  print(Object.keys(o).length);
}
{
  const print = printer("keys class-getter");
  class C { get a() { return 1; } }
  const o = new C();
  print(Object.keys(o).length);
}
{
  const print = printer("keys made-in-function");
  function make() { return { a: 1 }; }
  const o = make();
  print(Object.keys(o).length);
}
{
  const print = printer("in literal");
  const o = { a: 1 };
  print("a" in o);
}
{
  const print = printer("in literal-with-field");
  const o = { x: 1, a: 1 };
  print(o.x);
  print("a" in o);
}
{
  const print = printer("in class-field");
  class C { a = 1; }
  const o = new C();
  print("a" in o);
}
{
  const print = printer("in subclass-field");
  class B { a = 1; }
  class C extends B { y = 2; }
  const o = new C();
  print("a" in o);
}
{
  const print = printer("in class-static");
  class C { static a = 1; }
  const o = C;
  print("a" in o);
}
{
  const print = printer("in prototype-create");
  const p = { a: 1 };
  const o = Object.create(p);
  print("a" in o);
}
{
  const print = printer("in prototype-literal");
  const p = { a: 1 };
  const o = { __proto__: p };
  print("a" in o);
}
{
  const print = printer("in prototype-set-with-field");
  const p = { a: 1 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print("a" in o);
}
{
  const print = printer("in prototype-is-instance");
  class C { a = 1; }
  const o = Object.create(new C());
  print("a" in o);
}
{
  const print = printer("in stored-after");
  const o = {};
  o.a = 1;
  print("a" in o);
}
{
  const print = printer("in stored-after-with-field");
  const o = { x: 1 };
  o.a = 1;
  print("a" in o);
}
{
  const print = printer("in stored-after-on-prototype");
  const p = {};
  p.a = 1;
  const o = Object.create(p);
  print("a" in o);
}
{
  const print = printer("in constructor-function-this");
  function F() { this.a = 1; }
  const o = new F();
  print("a" in o);
}
{
  const print = printer("in stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.a = 1;
  const o = new C();
  print("a" in o);
}
{
  const print = printer("in getter");
  const o = { get a() { return 1; } };
  print("a" in o);
}
{
  const print = printer("in class-getter");
  class C { get a() { return 1; } }
  const o = new C();
  print("a" in o);
}
{
  const print = printer("in made-in-function");
  function make() { return { a: 1 }; }
  const o = make();
  print("a" in o);
}
{
  const print = printer("has-own literal");
  const o = { a: 1 };
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own literal-with-field");
  const o = { x: 1, a: 1 };
  print(o.x);
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own class-field");
  class C { a = 1; }
  const o = new C();
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own subclass-field");
  class B { a = 1; }
  class C extends B { y = 2; }
  const o = new C();
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own class-static");
  class C { static a = 1; }
  const o = C;
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own prototype-create");
  const p = { a: 1 };
  const o = Object.create(p);
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own prototype-literal");
  const p = { a: 1 };
  const o = { __proto__: p };
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own prototype-set-with-field");
  const p = { a: 1 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own prototype-is-instance");
  class C { a = 1; }
  const o = Object.create(new C());
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own stored-after");
  const o = {};
  o.a = 1;
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own stored-after-with-field");
  const o = { x: 1 };
  o.a = 1;
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own stored-after-on-prototype");
  const p = {};
  p.a = 1;
  const o = Object.create(p);
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own constructor-function-this");
  function F() { this.a = 1; }
  const o = new F();
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.a = 1;
  const o = new C();
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own getter");
  const o = { get a() { return 1; } };
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own class-getter");
  class C { get a() { return 1; } }
  const o = new C();
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("has-own made-in-function");
  function make() { return { a: 1 }; }
  const o = make();
  print(o.hasOwnProperty("a"), Object.hasOwn(o, "a"));
}
{
  const print = printer("own-names literal");
  const o = { a: 1 };
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names literal-with-field");
  const o = { x: 1, a: 1 };
  print(o.x);
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names class-field");
  class C { a = 1; }
  const o = new C();
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names subclass-field");
  class B { a = 1; }
  class C extends B { y = 2; }
  const o = new C();
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names class-static");
  class C { static a = 1; }
  const o = C;
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names prototype-create");
  const p = { a: 1 };
  const o = Object.create(p);
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names prototype-literal");
  const p = { a: 1 };
  const o = { __proto__: p };
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names prototype-set-with-field");
  const p = { a: 1 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names prototype-is-instance");
  class C { a = 1; }
  const o = Object.create(new C());
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names stored-after");
  const o = {};
  o.a = 1;
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names stored-after-with-field");
  const o = { x: 1 };
  o.a = 1;
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names stored-after-on-prototype");
  const p = {};
  p.a = 1;
  const o = Object.create(p);
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names constructor-function-this");
  function F() { this.a = 1; }
  const o = new F();
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.a = 1;
  const o = new C();
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names getter");
  const o = { get a() { return 1; } };
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names class-getter");
  class C { get a() { return 1; } }
  const o = new C();
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-names made-in-function");
  function make() { return { a: 1 }; }
  const o = make();
  print(Object.getOwnPropertyNames(o).length, Reflect.ownKeys(o).length);
}
{
  const print = printer("own-descriptor literal");
  const o = { a: 1 };
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor literal-with-field");
  const o = { x: 1, a: 1 };
  print(o.x);
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor class-field");
  class C { a = 1; }
  const o = new C();
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor subclass-field");
  class B { a = 1; }
  class C extends B { y = 2; }
  const o = new C();
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor class-static");
  class C { static a = 1; }
  const o = C;
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor prototype-create");
  const p = { a: 1 };
  const o = Object.create(p);
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor prototype-literal");
  const p = { a: 1 };
  const o = { __proto__: p };
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor prototype-set-with-field");
  const p = { a: 1 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor prototype-is-instance");
  class C { a = 1; }
  const o = Object.create(new C());
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor stored-after");
  const o = {};
  o.a = 1;
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor stored-after-with-field");
  const o = { x: 1 };
  o.a = 1;
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor stored-after-on-prototype");
  const p = {};
  p.a = 1;
  const o = Object.create(p);
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor constructor-function-this");
  function F() { this.a = 1; }
  const o = new F();
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.a = 1;
  const o = new C();
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor getter");
  const o = { get a() { return 1; } };
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor class-getter");
  class C { get a() { return 1; } }
  const o = new C();
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("own-descriptor made-in-function");
  function make() { return { a: 1 }; }
  const o = make();
  const d = Object.getOwnPropertyDescriptor(o, "a"); print(d === undefined ? "none" : d.value);
}
{
  const print = printer("computed-read literal");
  const o = { a: 1 };
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read literal-with-field");
  const o = { x: 1, a: 1 };
  print(o.x);
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read class-field");
  class C { a = 1; }
  const o = new C();
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read subclass-field");
  class B { a = 1; }
  class C extends B { y = 2; }
  const o = new C();
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read class-static");
  class C { static a = 1; }
  const o = C;
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read prototype-create");
  const p = { a: 1 };
  const o = Object.create(p);
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read prototype-literal");
  const p = { a: 1 };
  const o = { __proto__: p };
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read prototype-set-with-field");
  const p = { a: 1 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read prototype-is-instance");
  class C { a = 1; }
  const o = Object.create(new C());
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read stored-after");
  const o = {};
  o.a = 1;
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read stored-after-with-field");
  const o = { x: 1 };
  o.a = 1;
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read stored-after-on-prototype");
  const p = {};
  p.a = 1;
  const o = Object.create(p);
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read constructor-function-this");
  function F() { this.a = 1; }
  const o = new F();
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.a = 1;
  const o = new C();
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read getter");
  const o = { get a() { return 1; } };
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read class-getter");
  class C { get a() { return 1; } }
  const o = new C();
  const k = "a"; print(o[k]);
}
{
  const print = printer("computed-read made-in-function");
  function make() { return { a: 1 }; }
  const o = make();
  const k = "a"; print(o[k]);
}
{
  const print = printer("unknown-key-read literal");
  const o = { a: 1 };
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read literal-with-field");
  const o = { x: 1, a: 1 };
  print(o.x);
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read class-field");
  class C { a = 1; }
  const o = new C();
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read subclass-field");
  class B { a = 1; }
  class C extends B { y = 2; }
  const o = new C();
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read class-static");
  class C { static a = 1; }
  const o = C;
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read prototype-create");
  const p = { a: 1 };
  const o = Object.create(p);
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read prototype-literal");
  const p = { a: 1 };
  const o = { __proto__: p };
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read prototype-set-with-field");
  const p = { a: 1 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read prototype-is-instance");
  class C { a = 1; }
  const o = Object.create(new C());
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read stored-after");
  const o = {};
  o.a = 1;
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read stored-after-with-field");
  const o = { x: 1 };
  o.a = 1;
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read stored-after-on-prototype");
  const p = {};
  p.a = 1;
  const o = Object.create(p);
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read constructor-function-this");
  function F() { this.a = 1; }
  const o = new F();
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.a = 1;
  const o = new C();
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read getter");
  const o = { get a() { return 1; } };
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read class-getter");
  class C { get a() { return 1; } }
  const o = new C();
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("unknown-key-read made-in-function");
  function make() { return { a: 1 }; }
  const o = make();
  function read(x, k) { return x[k]; } print(read(o, "a")); print(read(o, "b"));
}
{
  const print = printer("rest-pattern literal");
  const o = { a: 1 };
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern literal-with-field");
  const o = { x: 1, a: 1 };
  print(o.x);
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern class-field");
  class C { a = 1; }
  const o = new C();
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern subclass-field");
  class B { a = 1; }
  class C extends B { y = 2; }
  const o = new C();
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern class-static");
  class C { static a = 1; }
  const o = C;
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern prototype-create");
  const p = { a: 1 };
  const o = Object.create(p);
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern prototype-literal");
  const p = { a: 1 };
  const o = { __proto__: p };
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern prototype-set-with-field");
  const p = { a: 1 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern prototype-is-instance");
  class C { a = 1; }
  const o = Object.create(new C());
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern stored-after");
  const o = {};
  o.a = 1;
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern stored-after-with-field");
  const o = { x: 1 };
  o.a = 1;
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern stored-after-on-prototype");
  const p = {};
  p.a = 1;
  const o = Object.create(p);
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern constructor-function-this");
  function F() { this.a = 1; }
  const o = new F();
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.a = 1;
  const o = new C();
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern getter");
  const o = { get a() { return 1; } };
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern class-getter");
  class C { get a() { return 1; } }
  const o = new C();
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("rest-pattern made-in-function");
  function make() { return { a: 1 }; }
  const o = make();
  const { ...rest } = o; print(rest.a);
}
{
  const print = printer("iterator-result-value literal");
  const o = { value: 47 };
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value literal-with-field");
  const o = { x: 1, value: 47 };
  print(o.x);
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value class-field");
  class C { value = 47; }
  const o = new C();
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value subclass-field");
  class B { value = 47; }
  class C extends B { y = 2; }
  const o = new C();
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value class-static");
  class C { static value = 47; }
  const o = C;
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value prototype-create");
  const p = { value: 47 };
  const o = Object.create(p);
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value prototype-literal");
  const p = { value: 47 };
  const o = { __proto__: p };
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value prototype-set-with-field");
  const p = { value: 47 };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value prototype-is-instance");
  class C { value = 47; }
  const o = Object.create(new C());
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value stored-after");
  const o = {};
  o.value = 47;
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value stored-after-with-field");
  const o = { x: 1 };
  o.value = 47;
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value stored-after-on-prototype");
  const p = {};
  p.value = 47;
  const o = Object.create(p);
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value constructor-function-this");
  function F() { this.value = 47; }
  const o = new F();
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.value = 47;
  const o = new C();
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value getter");
  const o = { get value() { return 47; } };
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value class-getter");
  class C { get value() { return 47; } }
  const o = new C();
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-value made-in-function");
  function make() { return { value: 47 }; }
  const o = make();
  let n = 0; const it = { [Symbol.iterator]() { return { next() { o.done = n++ > 0; return o; } }; } }; for (const x of it) print(x);
}
{
  const print = printer("iterator-result-done literal");
  const o = { done: true };
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done literal-with-field");
  const o = { x: 1, done: true };
  print(o.x);
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done class-field");
  class C { done = true; }
  const o = new C();
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done subclass-field");
  class B { done = true; }
  class C extends B { y = 2; }
  const o = new C();
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done class-static");
  class C { static done = true; }
  const o = C;
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done prototype-create");
  const p = { done: true };
  const o = Object.create(p);
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done prototype-literal");
  const p = { done: true };
  const o = { __proto__: p };
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done prototype-set-with-field");
  const p = { done: true };
  const o = { x: 1 };
  Object.setPrototypeOf(o, p);
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done prototype-is-instance");
  class C { done = true; }
  const o = Object.create(new C());
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done stored-after");
  const o = {};
  o.done = true;
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done stored-after-with-field");
  const o = { x: 1 };
  o.done = true;
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done stored-after-on-prototype");
  const p = {};
  p.done = true;
  const o = Object.create(p);
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done constructor-function-this");
  function F() { this.done = true; }
  const o = new F();
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done stored-on-class-prototype");
  class C { x = 1; }
  C.prototype.done = true;
  const o = new C();
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done getter");
  const o = { get done() { return true; } };
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done class-getter");
  class C { get done() { return true; } }
  const o = new C();
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}
{
  const print = printer("iterator-result-done made-in-function");
  function make() { return { done: true }; }
  const o = make();
  const it = { [Symbol.iterator]() { return { next() { return o; } }; } }; for (const x of it) print(x); print("end");
}

console.log(lines.join("\n"));

// GENERATED: printer [Symbol.toStringTag] length enumerable
// CHECK-LABEL: function {{*}}name="printer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_2]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.toStringTag]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="T"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.toStringTag]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="T"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="length"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="length"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="enumerable"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Convert v0 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="enumerable"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Convert v0 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
