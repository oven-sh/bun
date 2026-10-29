// RUN: lower
// OPTIONS: builtin-modules

// Classes of the program that extend Map, Set, WeakMap and WeakSet. The constructor of each calls `set` or `add` as it finds it on the new object, once for every entry it is given, and calls nothing when it is given none.
const say = (...values) => console.log(...values);

class Plain extends Map {}
const plain = new Plain();
say(plain.set(1, "one") === plain, plain.get(1).length, plain.size, plain instanceof Plain, plain instanceof Map, plain.constructor === Plain, Object.getPrototypeOf(plain) === Plain.prototype);
say(new Plain([[1, 2], [3, 4]]).size, [...new Plain([["k", { deep: true }]]).values()][0].deep, new Plain(null).size, new Plain(undefined).size);

class Counting extends Map {
  static made = 0;
  #stores = 0;
  label = "counting";
  constructor(entries, label) {
    super(entries);
    if (label) this.label = label;
    Counting.made++;
  }
  set(key, value) {
    // The field is not there yet while the constructor of Map runs.
    try { this.#stores++; } catch { Counting.early = (Counting.early ?? 0) + 1; }
    return super.set(key, typeof value === "function" ? value() : value);
  }
  get stores() { return this.#stores; }
  describe() { return `${this.label}: ${this.size} entries, ${this.#stores} stores`; }
}
const counting = new Counting([["a", () => "made by a call"], ["b", 2]], "given");
say(counting.describe(), Counting.early, counting.get("a").toUpperCase(), counting.get("b") + 1, Counting.made);
counting.set("c", () => [1, 2, 3]);
say(counting.describe(), counting.get("c").length, counting.stores, new Counting().describe(), Counting.early, Counting.made);
say(Map.prototype.set.call(counting, "d", 4) === counting, counting.stores, counting.size, Map.prototype.get.call(counting, "d"));

class Refusing extends Map { set() { throw new RangeError("no stores"); } }
try { new Refusing([[1, 2]]); } catch (error) { say(error instanceof RangeError, error.message); }
say(new Refusing().size, new Refusing([]).size);
class NoSetter extends Map {}
NoSetter.prototype.set = 5;
try { new NoSetter([[1, 2]]); } catch (error) { say(error instanceof TypeError); }
say(new NoSetter().size);

class Bag extends Set {
  added = [];
  add(value) { (this.added ?? (Bag.early ??= [])).push(value); return super.add(value); }
  static get [Symbol.species]() { return Set; }
}
const bag = new Bag(["x", "y", "x"]);
say(bag.size, Bag.early.join(), bag.added.length, bag.add("z").added.join(), bag.has("z"), [...bag].join(), bag instanceof Set);
say(bag.union(new Set(["w"])) instanceof Bag, bag.union(new Set(["w"])).size, new (class extends Set {})([1, 1, 2]).size);

const first = {}, second = {};
class Notes extends WeakMap { set(key, value) { Notes.calls = (Notes.calls ?? 0) + 1; return super.set(key, value); } }
const notes = new Notes([[first, "first"]]);
say(notes.get(first).length, notes.has(second), notes.set(second, () => "called").get(second)(), Notes.calls, notes instanceof WeakMap);
class Marks extends WeakSet { add(value) { Marks.calls = (Marks.calls ?? 0) + 1; return super.add(value); } }
say(new Marks([first, second]).has(second), Marks.calls, new Marks().has(first), new (class extends WeakSet {})().add(first).has(first));

// new.target decides what lies above the new object, and so which `set` the constructor finds.
const reflected = Reflect.construct(Map, [[["r", () => "through Counting"]]], Counting);
say(reflected instanceof Counting, reflected.get("r"), reflected.label, Counting.early);
say(Reflect.construct(Counting, [[["s", 1]]], Plain) instanceof Plain, Reflect.construct(Counting, [[["s", 1]]], Plain).label, Reflect.construct(Set, [[1]], Bag).added);

// GENERATED: say Counting stores Bag
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v6, v0
// CHECK-NEXT: v8 = CallList v5, v3, v6 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Counting"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Absent
// CHECK-NEXT: v5 = GetSuperBase v0
// CHECK-NEXT: v6 = SuperConstruct v5, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b16(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = CallDirect v7 function=[[f_4]]
// CHECK-NEXT: v11 = ToBoolean v3
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b7(| 0)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v13 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v14) frequency=Unlikely:
// CHECK-NEXT: v15 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v15
// CHECK-NEXT: b6(v16):
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v18 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropSet v17, v18 key="label"
// CHECK-NEXT: Jump -> next b8(v16)
// CHECK-NEXT: b7(v20):
// CHECK-NEXT: Jump -> next b8(v7)
// CHECK-NEXT: b8(v21: absent|[[L_3]]):
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="Counting"
// CHECK-NEXT: v24 = PropGet v23 key="made"
// CHECK-NEXT: v25 = Increment v24
// CHECK-NEXT: v26 = Convert v25 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v23, v26 key="made"
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: v29 = TypeTest v28 testedType=object
// CHECK-NEXT: Branch v29 -> taken b9(| 0), notTaken b10(| 0)
// CHECK-NEXT: b9(v30):
// CHECK-NEXT: Jump -> next b14(v30)
// CHECK-NEXT: b10(v31):
// CHECK-NEXT: v32 = TypeTest v31 testedType=undefined
// CHECK-NEXT: Branch v32 -> taken b11(| 0), notTaken b15(| 0)
// CHECK-NEXT: b11(v33):
// CHECK-NEXT: v34 = TypeTest v21 testedType=absent
// CHECK-NEXT: Branch v34 -> taken b12(| 0), notTaken b13(| 0)
// CHECK-NEXT: b12(v35) frequency=Unlikely:
// CHECK-NEXT: v36 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v36
// CHECK-NEXT: b13(v37):
// CHECK-NEXT: Jump -> next b14(v37)
// CHECK-NEXT: b14(v38):
// CHECK-NEXT: Return v38
// CHECK-NEXT: b15(v39) frequency=Unlikely:
// CHECK-NEXT: v40 = NewRuntimeError runtimeError=DerivedConstructorResult name="Counting"
// CHECK-NEXT: Throw v40
// CHECK-NEXT: b16(v41) frequency=Unlikely:
// CHECK-NEXT: v42 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v42
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="stores"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_3]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v3 = PrivateGet v1, v2 layout=[[L_3]] field=1
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Bag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_9]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
