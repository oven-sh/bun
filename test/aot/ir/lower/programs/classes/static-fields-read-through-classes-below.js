// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: read make Base Middle kindAbove
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]], v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: SwitchString v1 strings=["kind", "count", "ratio", "list", "nothing", "own", "computed"] -> case b2(| 0), case b4(| 0), case b6(| 0), case b8(| 0), case b10(| 0), case b12(| 0), case b14(| 0), otherwise b16()
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = PropGet v0 key="kind"
// CHECK-NEXT: Return v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v5 = PropGet v0 key="count"
// CHECK-NEXT: Return v5
// CHECK-NEXT: b6(v6):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v7 = PropGet v0 key="ratio"
// CHECK-NEXT: Return v7
// CHECK-NEXT: b8(v8):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v9 = PropGet v0 key="list"
// CHECK-NEXT: Return v9
// CHECK-NEXT: b10(v10):
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v11 = PropGet v0 key="nothing"
// CHECK-NEXT: Return v11
// CHECK-NEXT: b12(v12):
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v13 = PropGet v0 key="own"
// CHECK-NEXT: Return v13
// CHECK-NEXT: b14(v14):
// CHECK-NEXT: Jump -> next b15()
// CHECK-NEXT: b15():
// CHECK-NEXT: v15 = PropGet v0 key="computed"
// CHECK-NEXT: Return v15
// CHECK-NEXT: b16():
// CHECK-NEXT: Jump -> next b17()
// CHECK-NEXT: b17():
// CHECK-NEXT: v16 = PropGet v0 key="missing"
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|[[f_2]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure function=[[f_3]]
// CHECK-NEXT: v2 = NewClass v1 layout=[[L_4]]
// CHECK-NEXT: v3 = FinishClass v2 layout=[[L_4]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[f_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v3 declared={type=function flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v0, v2, v5 function=[[f_5]]
// CHECK-NEXT: v7 = Convert v3 declared={type=[[f_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = ResolveHeritage v7
// CHECK-NEXT: v9 = NewClosure function=[[f_6]]
// CHECK-NEXT: v10 = NewClass v9, v7, v8 layout=[[L_7]]
// CHECK-NEXT: v11 = FinishClass v10 layout=[[L_7]]
// CHECK-NEXT: v12 = Convert v11 declared={type=[[f_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v13 = Convert v11 declared={type=[[f_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Middle"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_11]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="kindAbove"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=function flags=[IsExpected]} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v2 = GetSuperBase v1
// CHECK-NEXT: v3 = SuperGet v2, v0 key="kind"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
