// RUN: lower
// OPTIONS: builtin-modules

// A store on an object that inherits a property from a built-in. The lock makes every property of a built-in read-only, and an inheritor may still override what was writable before: `error.name = ..`, `object.toString = ..`. What the language itself makes read-only (a function's length and name, Math.PI, Number.MAX_VALUE, Symbol.iterator) refuses the store, as in plain JavaScript.
function row(what, f) { try { console.log(what + ":", JSON.stringify(f())); } catch (e) { console.log(what + ":", "THROWS", e.name); } }
function named() { return 1; }
row("delete length, then store", () => { const d = delete named.length; named.length = 5; return [d, named.length, Object.hasOwn(named, "length")]; });
function named2(a, b) { return 1; }
row("delete name, then store", () => { const d = delete named2.name; named2.name = "other"; return [d, named2.name, Object.hasOwn(named2, "name")]; });
const arrow = (a) => a;
row("an arrow: delete length, then store", () => { delete arrow.length; arrow.length = 7; return [arrow.length, Object.hasOwn(arrow, "length")]; });
function named3(a) { return 1; }
row("store without deleting", () => { named3.length = 9; return named3.length; });
function named5(a) { return 1; }
row("deleted: what is read", () => { delete named5.length; delete named5.name; return [named5.length, named5.name, "length" in named5, Object.hasOwn(named5, "length")]; });
class K { static m() {} }
row("a class: delete name, then store", () => { delete K.name; K.name = "L"; return [K.name, Object.hasOwn(K, "name")]; });
row("a method: delete length, then store", () => { delete K.m.length; K.m.length = 3; return [K.m.length]; });
const bound = named3.bind(null);
row("a bound function", () => { delete bound.length; bound.length = 4; return [bound.length]; });
row("by Reflect.set", () => { function g(a) {} delete g.length; return [Reflect.set(g, "length", 5), g.length]; });
row("by a computed key", () => { function g(a) {} const k = ["len", "gth"].join(""); delete g[k]; g[k] = 5; return [g.length]; });
for (const [what, parent, key] of [["Function.prototype", Function.prototype, "length"], ["Function.prototype", Function.prototype, "name"], ["Math", Math, "PI"], ["Math", Math, "SQRT2"], ["Number", Number, "MAX_VALUE"], ["Number", Number, "EPSILON"], ["Number", Number, "NaN"], ["Symbol", Symbol, "iterator"], ["String.prototype", String.prototype, "length"], ["Uint8Array", Uint8Array, "BYTES_PER_ELEMENT"], ["Array", Array, "prototype"], ["Symbol.prototype", Symbol.prototype, Symbol.toStringTag], ["a built-in function", Array.prototype.push, "length"], ["a built-in function", Array.prototype.push, "name"]]) {
  row("read-only in the language: " + what + " " + String(key), () => { const o = Object.create(parent); o[key] = 3; return ["stored", Object.hasOwn(o, key)]; });
  row("read-only in the language, by Reflect.set: " + what + " " + String(key), () => { const o = Object.create(parent); return [Reflect.set(o, key, 3), Object.hasOwn(o, key)]; });
}
for (const [what, parent, key] of [["Object.prototype", Object.prototype, "toString"], ["Object.prototype", Object.prototype, "constructor"], ["Error.prototype", Error.prototype, "name"], ["Error.prototype", Error.prototype, "message"], ["TypeError.prototype", TypeError.prototype, "name"], ["Array.prototype", Array.prototype, "length"], ["Array.prototype", Array.prototype, "push"], ["Array.prototype", Array.prototype, Symbol.iterator], ["Math", Math, "max"], ["Number", Number, "parseFloat"], ["Error", Error, "stackTraceLimit"], ["Function.prototype", Function.prototype, "call"], ["Promise.prototype", Promise.prototype, "then"], ["Map.prototype", Map.prototype, "get"]]) {
  row("writable in the language: " + what + " " + String(key), () => { const o = Object.create(parent); o[key] = 3; return [o[key], Object.hasOwn(o, key)]; });
  row("writable in the language, by Reflect.set: " + what + " " + String(key), () => { const o = Object.create(parent); return [Reflect.set(o, key, 3), o[key]]; });
}
class Failure extends Error { constructor(m) { super(m); this.name = "Failure"; this.message = m + "!"; } }
row("the usual subclass of Error", () => { const f = new Failure("m"); return [f.name, f.message, String(f)]; });
class Limited extends Error {}
row("a static member of a subclass", () => { Limited.stackTraceLimit = 5; return [Limited.stackTraceLimit, Object.hasOwn(Limited, "stackTraceLimit")]; });
row("a frozen prototype of the program's own", () => { const p = Object.create(Object.freeze({ x: 1 })); p.x = 5; return p.x; });
row("hot", () => { let thrown = 0; for (let i = 0; i < 3000; i++) { const o = Object.create(Math); try { o.PI = i; } catch { thrown++; } o.max = i; } return thrown; });

// GENERATED: named K m Failure Limited
// CHECK-LABEL: function {{*}}name="named"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="K"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Failure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b14(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v9 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v10) frequency=Unlikely:
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v14 = String string="Failure"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropSet v13, v15 key="name"
// CHECK-NEXT: v17 = TypeTest v12 testedType=absent
// CHECK-NEXT: Branch v17 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v18) frequency=Unlikely:
// CHECK-NEXT: v19 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v19
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v22 = String string="!"
// CHECK-NEXT: v23 = Add v2, v22
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropSet v21, v24 key="message"
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: v27 = TypeTest v26 testedType=object
// CHECK-NEXT: Branch v27 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v28):
// CHECK-NEXT: Jump -> next b12(v28)
// CHECK-NEXT: b8(v29):
// CHECK-NEXT: v30 = TypeTest v29 testedType=undefined
// CHECK-NEXT: Branch v30 -> taken b9(| 0), notTaken b13(| 0)
// CHECK-NEXT: b9(v31):
// CHECK-NEXT: v32 = TypeTest v20 testedType=absent
// CHECK-NEXT: Branch v32 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v33) frequency=Unlikely:
// CHECK-NEXT: v34 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v34
// CHECK-NEXT: b11(v35):
// CHECK-NEXT: Jump -> next b12(v35)
// CHECK-NEXT: b12(v36):
// CHECK-NEXT: Return v36
// CHECK-NEXT: b13(v37) frequency=Unlikely:
// CHECK-NEXT: v38 = NewRuntimeError runtimeError=DerivedConstructorResult name="Failure"
// CHECK-NEXT: Throw v38
// CHECK-NEXT: b14(v39) frequency=Unlikely:
// CHECK-NEXT: v40 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v40
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Limited"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
