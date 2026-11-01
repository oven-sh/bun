// Members of a base change before its heirs are defined.
function show(label, constructors) {
  console.log(label);
  for (const constructor of constructors) {
    const object = new constructor();
    console.log(" ", constructor.name, object.a(), object.b(), object.c(), object.d(), object.v, object.w);
  }
}
class Base {
  a() { return "Base.a"; }
  b() { return "Base.b"; }
  c() { return "Base.c"; }
  d() { return "Base.d"; }
}
Base.prototype.a = function () { return "early a"; };
Base.prototype.b = function () { return "early b"; };
Base.prototype.c = function () { return "early c"; };
const seen = [];
Object.defineProperty(Base.prototype, "v", { set(value) { seen.push("v=" + value); }, get() { return "got v"; }, configurable: true });
Object.defineProperty(Base.prototype, "w", { set(value) { seen.push("w=" + value); }, get() { return "got w"; }, configurable: true });
class First extends Base {
  constructor() {
    super();
    this.v = 1;
    this.w = 2;
  }
  c() { return "First.c"; }
}
class Second extends First {}
show("heirs defined behind three stores and two setters", [Base, First, Second]);
Base.prototype.d = function () { return "late d"; };
delete Base.prototype.b;
Base.prototype.b = function () { return "b again"; };
show("one more store, a deletion and a store", [Base, First, Second]);
console.log(seen.join(" "));

function Old() {}
Old.prototype.a = function () { return "Old.a"; };
Old.prototype.b = function () { return "Old.b"; };
Old.prototype.c = function () { return "Old.c"; };
Old.prototype.d = function () { return "Old.d"; };
class New extends Old {
  b() { return "New.b"; }
}
class Newer extends New {}
show("a class below a constructor function", [Old, New, Newer]);
Old.prototype.a = function () { return "Old.a 2"; };
Old.prototype.b = function () { return "Old.b 2"; };
Old.prototype.c = function () { return "Old.c 2"; };
Old.prototype.d = function () { return "Old.d 2"; };
show("all four stored again", [Old, New, Newer]);
Object.assign(Old.prototype, { a() { return "assigned a"; }, c() { return "assigned c"; } });
show("two assigned", [Old, New, Newer]);
