// Several members of a base change under heirs.
class Base {
  a() { return "Base.a"; }
  b() { return "Base.b"; }
  c() { return "Base.c"; }
  d() { return "Base.d"; }
  e() { return "Base.e"; }
  static s() { return "Base.s"; }
  static t() { return "Base.t"; }
  static u() { return "Base.u"; }
}
class Middle extends Base {
  c() { return "Middle.c"; }
  static t() { return "Middle.t"; }
}
class Leaf extends Middle {
  constructor() {
    super();
    this.x = 1;
    this.y = 2;
    this.z = 3;
  }
}
class Other extends Base {
  d() { return "Other.d"; }
}
class Deep extends Leaf {}

function all(object) {
  return [object.a(), object.b(), object.c(), object.d(), object.e()].join(" ");
}
function statics(constructor) {
  return [constructor.s(), constructor.t(), constructor.u()].join(" ");
}
function fields(object) {
  return [object.x, object.y, object.z].join(" ");
}
function show(label) {
  console.log(label);
  for (const constructor of [Base, Middle, Leaf, Other, Deep]) console.log(" ", constructor.name, all(new constructor()), "|", statics(constructor));
  console.log("  fields", fields(new Leaf()), "|", fields(new Deep()));
}

show("as declared");
Base.prototype.a = function () { return "stored a"; };
show("a stored");
Base.prototype.b = function () { return "stored b"; };
show("b stored");
Base.prototype.c = function () { return "stored c"; };
show("c stored, which Middle declares");
Base.prototype.d = function () { return "stored d"; };
show("d stored, which Other declares");
Object.defineProperty(Base.prototype, "e", { value() { return "defined e"; }, configurable: true, writable: true });
show("e defined");
delete Base.prototype.a;
try {
  show("a deleted");
} catch (error) {
  console.log("  threw", error.constructor.name);
}
Base.prototype.a = function () { return "a again"; };
show("a again");
Base.s = function () { return "stored s"; };
show("s stored");
Base.t = function () { return "stored t"; };
show("t stored, which Middle declares");
Base.u = function () { return "stored u"; };
show("u stored");
const seen = [];
Object.defineProperty(Base.prototype, "x", { set(value) { seen.push("x=" + value); }, get() { return "got x"; }, configurable: true });
show("a setter for x above");
Object.defineProperty(Base.prototype, "y", { set(value) { seen.push("y=" + value); }, get() { return "got y"; }, configurable: true });
show("a setter for y above");
Object.defineProperty(Middle.prototype, "z", { set(value) { seen.push("z=" + value); }, get() { return "got z"; }, configurable: true });
show("a setter for z in the middle");
console.log(seen.join(" "));
Middle.prototype.a = function () { return "Middle a"; };
Middle.prototype.b = function () { return "Middle b"; };
Middle.prototype.e = function () { return "Middle e"; };
show("three stored in the middle");
Base.prototype.a = function () { return "Base a under Middle's"; };
Base.prototype.b = function () { return "Base b under Middle's"; };
show("two stored above what the middle holds now");
