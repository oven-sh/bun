// RUN: lower
// OPTIONS: builtin-modules

const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

console.log("strict:", (function () { return this === undefined; })());

class Base {
  constructor() {
    this.early = this.describe();
  }
  describe() {
    return "base";
  }
}
class Derived extends Base {
  x = 1;
  y = 2;
  list = [5, 6];
  text = "abc";
  step = value => value + 1;
  describe() {
    const results = [];
    for (const use of [() => this.x + this.y, () => this.x | 0, () => this.list.push(1), () => this.text.charCodeAt(0), () => this.step(1), () => Object.keys(this)]) results.push(outcome(use));
    return results.join(" ; ");
  }
}
for (let i = 0; i < 1000; i++) new Derived().describe();
{
  const made = new Derived();
  console.log("in the base constructor -> " + made.early);
  console.log("afterwards -> " + made.describe());
}

function OldBase() {
  this.early = this.sum();
}
OldBase.prototype.sum = function () {
  return "base";
};
function OldDerived() {
  OldBase.call(this);
  this.x = 1;
  this.y = 2;
}
OldDerived.prototype = Object.create(OldBase.prototype);
OldDerived.prototype.sum = function () {
  return this.x + this.y;
};
attempt("a constructor function whose parent calls the method early", () => {
  const made = new OldDerived();
  return [made.early, made.sum()];
});

function readsAVariableDeclaredBelow() {
  const before = outcome(() => later + 1);
  var later = 7;
  return [before, later + 1];
}
function readsALetDeclaredBelow() {
  const read = () => later + 1;
  const before = outcome(read);
  let later = 7;
  return [before, read()];
}
function callsAFunctionThatReadsAConstDeclaredBelow() {
  const before = outcome(helper);
  const list = [5, 6];
  function helper() {
    list.push(1);
    return list.length;
  }
  return [before, helper()];
}
function readsAClassDeclaredBelow() {
  const make = () => new Later().x;
  const before = outcome(make);
  class Later {
    x = 1;
  }
  return [before, make()];
}
function usesAParameterDeclaredToTheRight(a = () => b + 1, b = 7) {
  return a();
}
function usesAParameterToTheRightAtOnce(a = b + 1, b = 7) {
  return a;
}
function loopsOverClosuresMadeBeforeTheAssignment() {
  const reads = [];
  let n;
  for (let i = 0; i < 3; i++) reads.push(() => n + i);
  const before = reads.map(read => read());
  n = 7;
  const between = reads.map(read => read());
  n = "7";
  return [before, between, reads.map(read => read())];
}
for (let i = 0; i < 1000; i++) {
  readsAVariableDeclaredBelow();
  readsALetDeclaredBelow();
  callsAFunctionThatReadsAConstDeclaredBelow();
  readsAClassDeclaredBelow();
  usesAParameterDeclaredToTheRight();
  loopsOverClosuresMadeBeforeTheAssignment();
}
attempt("a var declared below", readsAVariableDeclaredBelow);
attempt("a let declared below", readsALetDeclaredBelow);
attempt("a const declared below, read by a hoisted function", callsAFunctionThatReadsAConstDeclaredBelow);
attempt("a class declared below", readsAClassDeclaredBelow);
attempt("a parameter to the right, read later", () => usesAParameterDeclaredToTheRight());
attempt("a parameter to the right, read at once", () => usesAParameterToTheRightAtOnce());
attempt("a parameter to the right, given", () => usesAParameterToTheRightAtOnce(undefined, 1));
attempt("closures made before the assignment", loopsOverClosuresMadeBeforeTheAssignment);

class Counted {
  static first = Counted.second + 1;
  static second = 7;
  static third = Counted.second + 1;
}
attempt("a static field that reads the next one", () => [Counted.first, Counted.second, Counted.third]);
attempt("a static field that reads its own class by a name set later", () => {
  const Made = class {
    static own = outcome(() => Made.name);
  };
  return Made.own;
});
attempt("an object literal that reads itself", () => {
  var o = { x: 1, y: outcome(() => o.x + 1) };
  return o;
});

// GENERATED: OldDerived describe Derived Counted
// CHECK-LABEL: function {{*}}name="OldDerived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = ToThis v0
// CHECK-NEXT: v2 = Convert v1 declared={type=[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = PropGet v3 key="call"
// CHECK-NEXT: v5 = Call v4, v3, v2 calleeKey="call" calleeName="OldBase.call"
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: PropSet v2, v6 key="x" mode=Sloppy
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: PropSet v2, v8 key="y" mode=Sloppy
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="base"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_6]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_5]]} results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: [[L_5]]):
// CHECK-NEXT: v1 = Data data=[[d_8]]
// CHECK-NEXT: v2 = NewClosure v0 function=[[f_9]]
// CHECK-NEXT: v3 = NewClosure v0 function=[[f_10]]
// CHECK-NEXT: v4 = NewClosure v0 function=[[f_11]]
// CHECK-NEXT: v5 = NewClosure v0 function=[[f_12]]
// CHECK-NEXT: v6 = NewClosure v0 function=[[f_13]]
// CHECK-NEXT: v7 = NewClosure v0 function=[[f_14]]
// CHECK-NEXT: v8 = NewArray v2, v3, v4, v5, v6, v7 contents=anything
// CHECK-NEXT: v9 = IteratorOpen v8
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v11 = IteratorResume v9
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: Branch v12 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v14 = PropGet v1 key="join"
// CHECK-NEXT: v15 = String string=" ; "
// CHECK-NEXT: v16 = Call v14, v1, v15 calleeKey="join" calleeName="results.join"
// CHECK-NEXT: ReturnCall v16
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v17 = PropGet v1 key="push"
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v19 = Call v18, -, v13 calleeName="outcome"
// CHECK-NEXT: v20 = Call v17, v1, v19 calleeKey="push" calleeName="results.push"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v9:
// CHECK-NEXT: v21 = CatchException
// CHECK-NEXT: IteratorClose v9 completion=Throw
// CHECK-NEXT: Rethrow v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Counted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_16]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_16]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_16]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
