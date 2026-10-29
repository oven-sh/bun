// RUN: lower
// OPTIONS: builtin-modules

// Public fields of a class that extends Array: each is defined on the new array as on any object: in order, enumerable, writable and
// configurable, past setters and read-only properties of the prototypes; `length` and names that are indexes keep the meaning an array
// gives them; an array that takes no more properties refuses; and the elements stay what they were when the storage grows.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
function visited() { return count("operationAOTPutByIdAndCache") + count("operationAOTAddPropertyBySlot"); }
function counted() { return visited() > 0; }
function show(value) { return typeof value === "function" ? "function" : typeof value === "symbol" ? String(value) : value === undefined ? "undefined" : JSON.stringify(value); }
function describe(o) {
  var parts = [];
  for (var key of Reflect.ownKeys(o)) {
    var d = Object.getOwnPropertyDescriptor(o, key);
    parts.push(String(key) + "=" + ("value" in d ? show(d.value) : "accessor") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""));
  }
  return parts.join(" ");
}
function attempt(label, work) { var answer; try { answer = work(); } catch (error) { answer = "threw " + error.constructor.name + ": " + error.message; } console.log(label + ": " + answer); }

class Four extends Array { first; second = 2; third = "three"; fourth = null; }
class One extends Array { only = 1; }
class Nine extends Array { a = 1; b = 2; c = 3; d = 4; e = 5; f = 6; g = 7; h = 8; i = 9; }
class Deeper extends Four { fifth = 5; sixth = this.second + this.length; }
class Twenty extends Nine { j = 10; k = 11; l = 12; m = 13; n = 14; o = 15; p = 16; q = 17; r = 18; s = 19; t = 20; }
for (var Class of [Four, One, Nine, Deeper, Twenty]) {
  attempt(Class.name + " empty", function () { return describe(new Class); });
  attempt(Class.name + " of a length", function () { return describe(new Class(3)); });
  attempt(Class.name + " of integers", function () { return describe(new Class(1, 2, 3)); });
  attempt(Class.name + " of doubles", function () { return describe(new Class(1.5, 2.5)); });
  attempt(Class.name + " of values", function () { return describe(new Class("a", {}, null, undefined)); });
  attempt(Class.name + " from", function () { return describe(Class.from([1, 2, 3, 4, 5, 6, 7, 8, 9])); });
  attempt(Class.name + " of", function () { return describe(Class.of(7)); });
  attempt(Class.name + " mapped", function () { return describe(new Class(1, 2, 3).map(function (x) { return x * 2; })); });
  attempt(Class.name + " keys", function () { var keys = []; for (var key in new Class(1, 2)) keys.push(key); return keys.join(" ") + " | " + JSON.stringify(new Class(1, 2)) + " | " + Array.isArray(new Class) + " " + (new Class instanceof Class); });
  attempt(Class.name + " grows behind", function () { var o = new Class(1, 2); for (var i = 0; i < 40; i++) o.push(i); o.later = "later"; o[100] = "far"; return o.length + " " + o[0] + " " + o[41] + " " + o.later + " " + Object.keys(o).length; });
}

class Sparse extends Array { constructor() { super(); this[5000000] = "far"; } }
class SparseWithFields extends Sparse { a = 1; b = 2; }
attempt("sparse", function () { var o = new SparseWithFields; return o.length + " " + o[5000000] + " " + o.a + o.b + " " + Object.keys(o).join(" "); });
class Holes extends Array { a = 1; b = 2; c = 3; d = 4; e = 5; }
attempt("holes", function () { var o = new Holes(1, 2, 3); delete o[1]; return describe(o); });

class NamedLength extends Array { length = 2; after = "after"; }
attempt("a field named length", function () { return describe(new NamedLength(1, 2, 3, 4)); });
class BadLength extends Array { length = -1; }
attempt("a field named length that is no length", function () { return describe(new BadLength(1)); });
class Indexes extends Array { 0 = "zero"; "1" = "one"; 7 = "seven"; name = "name"; }
attempt("fields that are indexes", function () { return describe(new Indexes("a", "b", "c")); });
var computed = "computed", symbol = Symbol("symbol");
class Computed extends Array { [computed] = 1; [symbol] = 2; ["3"] = 3; ["length"] = 5; }
attempt("computed names", function () { return describe(new Computed); });
class Proto extends Array { __proto__ = "a field"; constructor_ = 1; }
attempt("a field named __proto__", function () { var o = new Proto; return describe(o) + " | " + (Object.getPrototypeOf(o) === Proto.prototype); });

class WithSetters extends Array { set guarded(value) { throw new Error("the setter ran"); } get guarded() { return "from the getter"; } }
class PastSetters extends WithSetters { guarded = "defined"; }
attempt("past a setter of the prototype", function () { return describe(new PastSetters); });
class ReadOnlyAbove extends Array {}
Object.defineProperty(ReadOnlyAbove.prototype, "fixed", { value: "above", writable: false });
class PastReadOnly extends ReadOnlyAbove { fixed = "own"; }
attempt("past a read-only property of the prototype", function () { return describe(new PastReadOnly); });

class Closed extends Array { constructor() { super(); Object.preventExtensions(this); } }
class FieldsOnClosed extends Closed { a = 1; }
attempt("an array that takes no more", function () { return describe(new FieldsOnClosed); });
class Frozen extends Array { constructor() { super(1, 2); Object.freeze(this); } }
class FieldsOnFrozen extends Frozen { a = 1; }
attempt("a frozen array", function () { return describe(new FieldsOnFrozen); });
class Has extends Array { constructor(descriptor) { super(); Object.defineProperty(this, "a", descriptor); } }
class Again extends Has { a = "again"; b = "b"; }
attempt("there already, plain", function () { return describe(new Again({ value: 1, writable: true, enumerable: true, configurable: true })); });
attempt("there already, hidden", function () { return describe(new Again({ value: 1, writable: true, enumerable: false, configurable: true })); });
attempt("there already, read-only", function () { return describe(new Again({ value: 1, writable: false, enumerable: true, configurable: true })); });
attempt("there already, an accessor", function () { return describe(new Again({ get() { return 1; }, configurable: true })); });
attempt("there already, fixed", function () { return describe(new Again({ value: 1, writable: true, enumerable: true, configurable: false })); });
attempt("there already, fixed and read-only", function () { return describe(new Again({ value: 1 })); });

class Returns extends Array { constructor(other) { super(); return other; } }
class FieldsOnReturned extends Returns { a = 1; b = 2; }
attempt("the constructor returns a plain object", function () { return describe(new FieldsOnReturned({ x: 0 })); });
attempt("the constructor returns a plain array", function () { return describe(new FieldsOnReturned([1, 2])); });
attempt("the constructor returns an array literal of doubles", function () { return describe(new FieldsOnReturned([1.5])); });
attempt("the constructor returns a function", function () { return describe(new FieldsOnReturned(function f() {})).replace(/prototype=\S+ /, ""); });
attempt("the constructor returns a proxy", function () { var log = []; var o = new FieldsOnReturned(new Proxy([], { defineProperty(t, key, d) { log.push("define " + String(key) + " " + JSON.stringify(d)); return Reflect.defineProperty(t, key, d); } })); return log.join(" ; ") + " | " + describe(o); });
attempt("the constructor returns a proxy that refuses", function () { return describe(new FieldsOnReturned(new Proxy([], { defineProperty() { return false; } }))); });
attempt("the constructor returns a typed array", function () { return describe(new FieldsOnReturned(new Uint8Array(2))); });
attempt("the constructor returns the prototype of another class", function () { class Other extends Array {} var o = new FieldsOnReturned(Other.prototype); return describe(o).replace(/constructor=\S+ /, "") + " | " + new Other().a; });

// The same literal twice: what is added to one is not seen on the other.
function literal() { return [1, 2, 3]; }
attempt("array literals", function () { var one = new FieldsOnReturned(literal()), two = literal(); one.push(4); return describe(one) + " | " + describe(two); });

// Only the first field of each array, which needs new storage, reaches the runtime.
var made = [];
var visits = visited();
for (var i = 0; i < 300; i++) made.push(new Four(i, i + 1));
visits = visited() - visits;
console.log(made.length, made[299].second, made[299][1], !counted() || visits === 300);

// GENERATED: Four Has defineProperty
// CHECK-LABEL: function {{*}}name="Four"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_3]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|boolean|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|boolean|number|string|symbol|bigint|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1 layout=[[L_6]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v11 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v12) frequency=Unlikely:
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v16 = String string="a"
// CHECK-NEXT: v17 = Call v10, v9, v15, v16, v2 calleeName="Object.defineProperty"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = TypeTest v18 testedType=object
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: Jump -> next b10(v20)
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: v22 = TypeTest v21 testedType=undefined
// CHECK-NEXT: Branch v22 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v23):
// CHECK-NEXT: v24 = TypeTest v14 testedType=absent
// CHECK-NEXT: Branch v24 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v25) frequency=Unlikely:
// CHECK-NEXT: v26 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v26
// CHECK-NEXT: b9(v27):
// CHECK-NEXT: Jump -> next b10(v27)
// CHECK-NEXT: b10(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: b11(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=DerivedConstructorResult name="Has"
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b12(v31) frequency=Unlikely:
// CHECK-NEXT: v32 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="defineProperty"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 captures=[{type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|Array<never> flags=[IsExpected]}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: undefined|null|Array<never>, v2: undefined|null|string|symbol, v3: undefined|null|number|string|symbol|bigint|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = PropGet v0 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="define "
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v7, -, v2 calleeName="String"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v10 = Add v6, v9
// CHECK-NEXT: v11 = String string=" "
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = Builtin builtin=JSON
// CHECK-NEXT: v14 = PropGet v13 key="stringify"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v15, v13, v3 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v18 = Add v12, v17
// CHECK-NEXT: v19 = Call v5, v0, v18 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v20 = Builtin builtin=Reflect
// CHECK-NEXT: v21 = Builtin builtin=ReflectDefineProperty
// CHECK-NEXT: v22 = Call v21, v20, v1, v2, v3 calleeName="Reflect.defineProperty"
// CHECK-NEXT: ReturnCall v22 casts=[{declared={type=boolean flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="defineProperty"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=false flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean
// CHECK-NEXT: v1 = Convert v0 declared={type=false flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
