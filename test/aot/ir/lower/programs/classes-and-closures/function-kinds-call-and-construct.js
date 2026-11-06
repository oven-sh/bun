// RUN: lower
// OPTIONS: builtin-modules

// Functions of every kind are called, constructed with `new`, and constructed with Reflect.construct for another new.target.
class Other {}

const receiver = {};
const seen = [];
function note(target) {
  seen.push(target === undefined ? "undefined" : target === Other ? "Other" : target.name);
}

function plain() {
  note(new.target);
  return this === receiver ? "plain with the bound this" : "plain";
}
const arrow = () => "arrow";
const holder = {
  method() {
    note(new.target);
    return this === receiver ? "method with the bound this" : "method";
  },
  get getter() {
    note(new.target);
    return "getter";
  },
};
async function asyncFunction() { note(new.target); }
function* generator() { note(new.target); }
async function* asyncGenerator() { note(new.target); }
class Base {
  constructor() { note(new.target); }
}
class Derived extends Base {
  constructor() {
    note(new.target);
    super();
  }
}
const Anonymous = class {};
const Alias = class Named {};
function onlyCalled() { return new.target; }

const kinds = {
  "plain": plain,
  "arrow": arrow,
  "method": holder.method,
  "getter": Object.getOwnPropertyDescriptor(holder, "getter").get,
  "async function": asyncFunction,
  "generator": generator,
  "async generator": asyncGenerator,
  "base class": Base,
  "derived class": Derived,
  "bound plain": plain.bind(receiver),
  "bound method": holder.method.bind(receiver),
};

function describe(value) {
  if (typeof value !== "object" || value === null) return String(value);
  const tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Object") return "object of " + Object.getPrototypeOf(value).constructor.name;
  if (tag.endsWith("Generator")) value.next();
  return tag;
}

function attempt(label, run) {
  seen.length = 0;
  let outcome;
  try {
    outcome = describe(run());
  } catch (error) {
    // Plain Bun names the expression that is not a constructor, compiled code names the kind of value.
    outcome = error.constructor.name + ": " + error.message.replace(/^.* is not a constructor.*$/s, "not a constructor");
  }
  return label + ": " + outcome + (seen.length ? ", new.target " + seen.join(" then ") : "");
}

function attemptThroughValues() {
  const lines = [];
  for (const [kind, callee] of Object.entries(kinds)) {
    lines.push(attempt(kind + " called", () => callee()));
    lines.push(attempt(kind + " constructed", () => new callee()));
    lines.push(attempt(kind + " constructed for Other", () => Reflect.construct(callee, [], Other)));
  }
  return lines.join("\n");
}

const first = attemptThroughValues();
console.log(first);
for (let round = 0; round < 3; round++) console.log("same outcomes again:", attemptThroughValues() === first);

console.log(attempt("plain()", () => plain()));
console.log(attempt("new plain()", () => new plain()));
console.log(attempt("new arrow()", () => new arrow()));
console.log(attempt("new holder.method()", () => new holder.method()));
console.log(attempt("new asyncFunction()", () => new asyncFunction()));
console.log(attempt("new generator()", () => new generator()));
console.log(attempt("new asyncGenerator()", () => new asyncGenerator()));
console.log(attempt("Base()", () => Base()));
console.log(attempt("Derived()", () => Derived()));
console.log(attempt("Anonymous()", () => Anonymous()));
console.log(attempt("Alias()", () => Alias()));
console.log(attempt("new Base()", () => new Base()));
console.log(attempt("new Derived()", () => new Derived()));
console.log(attempt("Reflect.construct(Derived, [], Other)", () => Reflect.construct(Derived, [], Other)));
console.log(attempt("onlyCalled()", () => onlyCalled()));

// GENERATED: asyncFunction generator asyncGenerator Other getter Derived
// CHECK-LABEL: function {{*}}name="asyncFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = Call v2, -, v1 calleeName="note"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="generator"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<never> flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = Call v4, -, v2 calleeName="note"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asyncGenerator"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, HasThis, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|AsyncGenerator<never> flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = Call v4, -, v2 calleeName="note"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Other"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="note"
// CHECK-NEXT: v3 = String string="getter"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = Call v3, -, v1 calleeName="note"
// CHECK-NEXT: v5 = GetSuperBase v0
// CHECK-NEXT: v6 = SuperConstruct v5, v1 layout=[[L_8]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b10(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: v11 = TypeTest v10 testedType=object
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b8(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = TypeTest v13 testedType=undefined
// CHECK-NEXT: Branch v14 -> taken b5(| 0), notTaken b9(| 0)
// CHECK-NEXT: b5(v15):
// CHECK-NEXT: v16 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v16 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v17) frequency=Unlikely:
// CHECK-NEXT: v18 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v18
// CHECK-NEXT: b7(v19):
// CHECK-NEXT: Jump -> next b8(v19)
// CHECK-NEXT: b8(v20):
// CHECK-NEXT: Return v20
// CHECK-NEXT: b9(v21) frequency=Unlikely:
// CHECK-NEXT: v22 = NewRuntimeError runtimeError=DerivedConstructorResult name="Derived"
// CHECK-NEXT: Throw v22
// CHECK-NEXT: b10(v23) frequency=Unlikely:
// CHECK-NEXT: v24 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v24
// CHECK-NEXT: }
