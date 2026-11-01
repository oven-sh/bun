// Flags: --aot-heat=everything-is-cold
// A method that was renamed shows its new name in a frame where the call stands in cold code, from the first object of its class on: the call enters the function object that was renamed.
const rename = (f, name) => Object.defineProperty(f, "name", { value: name });
const top = stack => stack.split("\n")[1].trim().split(" ").slice(0, 2).join(" ");
function staticMethod(turn) {
  class C { static s() { return new Error("x").stack; } }
  rename(C.s, "static" + turn);
  console.log("static:", top(C.s()), top(C.s()));
}
function calledBefore(turn) {
  class C { static s() { return new Error("x").stack; } }
  const before = top(C.s());
  rename(C.s, "later" + turn);
  console.log("called before:", before, top(C.s()));
}
function method(turn) {
  class C { m() { return new Error("x").stack; } }
  rename(C.prototype.m, "method" + turn);
  console.log("method:", top(new C().m()));
}
function inherited(turn) {
  class Base { static s() { return new Error("x").stack; } m() { return new Error("x").stack; } }
  class Derived extends Base {}
  rename(Base.s, "baseStatic" + turn);
  rename(Base.prototype.m, "baseMethod" + turn);
  console.log("inherited:", top(Derived.s()), top(new Derived().m()));
}
function twoClasses(turn) {
  class A { m() { return new Error("x").stack; } }
  class B { m() { return new Error("x").stack; } }
  rename(A.prototype.m, "ofA" + turn);
  rename(B.prototype.m, "ofB" + turn);
  for (const o of [new A(), new B(), new A()]) console.log("two classes:", top(o.m()));
}
function objectMethod(turn) {
  const o = { m() { return new Error("x").stack; } };
  rename(o.m, "ofObject" + turn);
  console.log("object:", top(o.m()));
}
function inALoop(turn) {
  class C { static s() { return new Error("x").stack; } }
  rename(C.s, "looped" + turn);
  let last;
  for (let i = 0; i < 3; i++) last = top(C.s());
  console.log("in a loop:", last);
}
function deleted(turn) {
  class C { static s() { return new Error("x").stack; } }
  delete C.s.name;
  console.log("name deleted:", top(C.s()));
}
function throughSuper(turn) {
  class Base { static s() { return new Error("x").stack; } }
  class Derived extends Base { static t() { return super.s(); } }
  rename(Base.s, "superStatic" + turn);
  console.log("super:", top(Derived.t()));
}
for (let turn = 0; turn < 2; turn++) {
  staticMethod(turn);
  calledBefore(turn);
  method(turn);
  inherited(turn);
  twoClasses(turn);
  objectMethod(turn);
  inALoop(turn);
  deleted(turn);
  throughSuper(turn);
}
