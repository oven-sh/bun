// RUN: lower
// OPTIONS: builtin-modules

// A base constructor returns an object of its own choice, or what is no object, to classes below it, which lay their fields and private names on what they get.
const lines = [];
const chain = o => { const names = []; for (let p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) names.push(Object.hasOwn(p, "constructor") && typeof p.constructor === "function" ? p.constructor.name : "?"); return names.join("<"); };
const say = (what, made) => lines.push(what + ": " + (made === null || typeof made !== "object" ? String(made) : chain(made) + " | " + Reflect.ownKeys(made).map(String).join() + " | " + JSON.stringify(made)));
const attempt = (what, f) => { try { say(what, f()); } catch (error) { lines.push(what + ": " + error.constructor.name + ": " + error.message); } };
const again = (turns, f) => { let made; for (let i = 0; i < turns; i++) made = f(i); return made; };
const shared = { shared: true };
class Returns { a = 1; constructor(what) { this.x = 1; if (what === 1) return shared; if (what === 2) return [1, 2]; if (what === 3) return 5; if (what === 4) return function f() { }; if (what === 5) return new Map(); if (what === 6) return null; if (what === 7) return Object.create(null); } }
class Below extends Returns { b = 2; constructor(what) { super(what); this.y = 2; } }
class Lower extends Below { #p = 3; c = 3; read() { return this.#p; } static has(o) { return #p in o; } }
class ReturnsBelow extends Returns { constructor(what) { super(0); if (what === 1) return shared; if (what === 3) return 5; if (what === 8) return undefined; } }
const byValue = (C, x) => new C(x);
for (const C of [Returns, Below, Lower, ReturnsBelow]) for (let what = 0; what < 9; what++) {
  for (const key of Object.keys(shared)) if (key !== "shared") delete shared[key];
  attempt(C.name + " " + what, () => { const made = again(what === 1 && C === Lower ? 1 : 30, () => byValue(C, what)); return typeof made === "function" ? { isFunction: true, keys: Object.keys(made).join() } : made instanceof Map ? { isMap: true, keys: Object.keys(made).join() } : made; });
}
lines.push(String(Lower.has(byValue(Lower, 0))), String(Lower.has(byValue(Lower, 2))), String(Lower.has(byValue(Below, 0))), String(byValue(Lower, 0).read()));
function OldBase(what) { this.o = 1; if (what) return shared; }
class BelowOld extends OldBase { n = 1; }
attempt("below a function", () => again(30, () => byValue(BelowOld, 0)));
attempt("below a function that returns", () => again(1, () => byValue(BelowOld, 1)));
attempt("a function for a class", () => again(30, () => Reflect.construct(OldBase, [0], Below)));
attempt("a class for a function", () => again(30, () => Reflect.construct(Below, [0], OldBase)));
console.log(lines.join("\n"));

// GENERATED: Below Lower read has byValue
// CHECK-LABEL: function {{*}}name="Below"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = CallDirect v6 function=[[f_3]]
// CHECK-NEXT: v10 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v11) frequency=Unlikely:
// CHECK-NEXT: v12 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v12
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v15 = Integer integer=2
// CHECK-NEXT: v16 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v14, v16 key="y"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = TypeTest v18 testedType=object
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: Jump -> next b10(v20)
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: v22 = TypeTest v21 testedType=undefined
// CHECK-NEXT: Branch v22 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v23):
// CHECK-NEXT: v24 = TypeTest v13 testedType=absent
// CHECK-NEXT: Branch v24 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v25) frequency=Unlikely:
// CHECK-NEXT: v26 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v26
// CHECK-NEXT: b9(v27):
// CHECK-NEXT: Jump -> next b10(v27)
// CHECK-NEXT: b10(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: b11(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=DerivedConstructorResult name="Below"
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b12(v31) frequency=Unlikely:
// CHECK-NEXT: v32 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Lower"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_6]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_5]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v3 = PrivateGet v1, v2 layout=[[L_5]] field=1
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v2 = PrivateHas v0, v1 layout=[[L_5]] field=1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="byValue"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Construct v0, -, v2 calleeName="C"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
