// A static field is read through the classes below the one that declares it: by name on a value nobody follows, by `super.name` in a static method, with `in` and hasOwnProperty.
// Each read runs often enough to be remembered, and then the field is stored to, hidden, deleted, redefined, or the chain of classes is changed.
// Only the jsc shell can count how often the run time is asked. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const asked = () => count("operationAOTGetByIdAndCache") + count("operationAOTGetById") + count("operationAOTGetSuperPropertyById");
class Base {
  static kind = "a base";
  static count = 1;
  static ratio = 0.5;
  static list = [1, 2];
  static nothing = undefined;
  static get computed() { return "computed for " + this.name; }
}
class Middle extends Base {
  static own = "of the middle";
}
class Leaf extends Middle {
  static kindAbove() { return super.kind; }
  static countAbove() { return super.count; }
  static computedAbove() { return super.computed; }
  static missingAbove() { return super.missing; }
}
const classes = [Base, Middle, Leaf];
const names = ["kind", "count", "ratio", "list", "nothing", "own", "computed", "missing"];
function read(value, name) {
  switch (name) {
    case "kind": return value.kind;
    case "count": return value.count;
    case "ratio": return value.ratio;
    case "list": return value.list;
    case "nothing": return value.nothing;
    case "own": return value.own;
    case "computed": return value.computed;
    default: return value.missing;
  }
}
function show() {
  const lines = new Set();
  for (let turn = 0; turn < 8; turn++) {
    const parts = [];
    for (const value of classes) {
      for (const name of names) parts.push(String(read(value, name)) + (name in value ? "+" : "-") + (Object.prototype.hasOwnProperty.call(value, name) ? "o" : ""));
    }
    parts.push(Leaf.kindAbove(), Leaf.countAbove(), Leaf.computedAbove(), Leaf.missingAbove());
    lines.add(parts.join(" "));
  }
  return [...lines].join("\n");
}
function step(what, change) {
  change();
  console.log(what + ":\n" + show());
}
step("as declared", () => {});
let most = 0;
for (const value of classes) {
  for (const name of ["kind", "count", "ratio", "list", "nothing"]) {
    const before = asked();
    for (let i = 0; i < 500; i++) read(value, name);
    most = Math.max(most, asked() - before);
  }
}
for (const above of [() => Leaf.kindAbove(), () => Leaf.countAbove()]) {
  const before = asked();
  for (let i = 0; i < 500; i++) above();
  most = Math.max(most, asked() - before);
}
console.log(most <= 3 ? "no static field was asked of the run time more than three times" : "the run time was asked " + most + " times in 500 reads of one static field");
step("stored to on the class that declares them", () => { Base.kind = "changed"; Base.count = 2; Base.ratio = 1.5; Base.list = null; Base.nothing = "something"; });
step("a value of another kind", () => { Base.count = "three"; Base.ratio = { valueOf() { return 4; } }; Base.kind = 5; });
step("stored to on the class in the middle", () => { Middle.kind = "of the middle"; });
step("and on the one below", () => { Leaf.kind = "of the leaf"; Leaf.count = 7; });
step("those are deleted", () => { delete Middle.kind; delete Leaf.kind; delete Leaf.count; });
step("the declared one is deleted", () => { delete Base.kind; });
step("and comes back", () => { Base.kind = "back"; });
step("becomes an accessor", () => { Object.defineProperty(Base, "count", { get() { return "counted for " + this.name; }, configurable: true }); });
step("becomes read-only", () => { Object.defineProperty(Base, "ratio", { value: 9, writable: false }); try { Middle.ratio = 10; } catch (error) { console.log(error.constructor.name); } });
step("a name arrives in the middle", () => { Middle.missing = "found"; });
step("the middle gets another parent", () => { Object.setPrototypeOf(Middle, { kind: "of a stranger", count: -1 }); });
step("and its own again", () => { Object.setPrototypeOf(Middle, Base); });
step("the leaf goes straight to the base", () => { Object.setPrototypeOf(Leaf, Base); });
step("frozen", () => { Object.freeze(Base); try { Base.kind = "no"; } catch (error) { console.log(error.constructor.name); } });

// The same class text evaluated twice: each class object has fields of its own.
function make(label) {
  class Made { static label = label; static tally = 0; }
  class Below extends Made {}
  return Below;
}
const first = make("first"), second = make("second");
function labels(value) { let text = ""; for (let i = 0; i < 8; i++) text = value.label + ":" + value.tally; return text; }
Object.getPrototypeOf(first).tally = 3;
console.log(labels(first), labels(second), labels(Object.getPrototypeOf(first)), labels(Object.getPrototypeOf(second)));

// Read while the class above is still being defined.
const early = [];
class Outer {
  static a = 1;
  static seen = (() => { class Inner extends Outer {} const found = []; for (let i = 0; i < 8; i++) found.push(Inner.a, Inner.b); return found.join(); })();
  static b = 2;
}
class InnerLater extends Outer {}
for (let i = 0; i < 8; i++) early.push(InnerLater.a + InnerLater.b);
console.log(Outer.seen, early.join());
