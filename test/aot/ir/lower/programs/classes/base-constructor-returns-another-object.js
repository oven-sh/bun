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
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything):
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_2]]}
// CHECK-NEXT: v7 = CallDirect v6 function=[[f_3]]
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: PropSet v6, v8 key="y"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Lower"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_6]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_5]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_5]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_5]] field=1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v2 = PrivateHas v0, v1 layout=[[L_5]] field=1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="byValue"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: anything):
// CHECK-NEXT: v2 = Construct v0, -, v1 calleeName="C"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
