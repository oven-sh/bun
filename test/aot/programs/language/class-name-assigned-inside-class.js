// Within a class its name is a constant: an assignment evaluates its right side and throws a TypeError.
const log = [];
function tell(name, f) {
  try {
    console.log(name, f());
  } catch (error) {
    console.log(name, error.constructor.name, error.message, log.splice(0).join());
  }
}
const value = () => (log.push("the right side"), 42);
tell("a constructor", () => { class C { constructor() { C = value(); } } return new C(); });
tell("a constructor of an expression", () => new (class C { constructor() { C = value(); } })());
tell("a method", () => { class C { m() { C = value(); } } return new C().m(); });
tell("a method of an expression", () => new (class C { m() { C = value(); } })().m());
tell("a getter", () => { class C { get x() { C = value(); return 1; } } return new C().x; });
tell("a setter", () => { class C { set x(_) { C = value(); } } return (new C().x = 15); });
tell("a static method", () => { class C { static m() { C = value(); } } return C.m(); });
tell("a field", () => { class C { f = (C = value()); } return new C().f; });
tell("a static block", () => { class C { static { C = value(); } } return C; });
tell("an arrow function in a method", () => { class C { m() { return () => { C = value(); }; } } return new C().m()(); });
tell("+=", () => { class C { m() { C += value(); } } return new C().m(); });
tell("++", () => { class C { m() { C++; } } return new C().m(); });
tell("a pattern", () => { class C { m() { [C] = [value()]; } } return new C().m(); });
tell("another class's name", () => { let D = class {}; class C { m() { D = value(); return D; } } return new C().m(); });
tell("a parameter of that name", () => { class C { m(C) { C = value(); return C; } } return new C().m(); });
class AtTheTop { m() { AtTheTop = value(); } }
tell("at the top level", () => new AtTheTop().m());
