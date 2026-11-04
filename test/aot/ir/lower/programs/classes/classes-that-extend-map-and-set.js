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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: Array):
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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything, v3: anything):
// CHECK-NEXT: v4 = Absent
// CHECK-NEXT: v5 = GetSuperBase v0
// CHECK-NEXT: v6 = SuperConstruct v5, v1, v2 layout=[[L_1]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_1]]}
// CHECK-NEXT: v8 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b13(| 0)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: v10 = CallDirect v7 function=[[f_2]]
// CHECK-NEXT: v11 = ToBoolean v3
// CHECK-NEXT: Branch v11 -> taken b2(| 0), notTaken b5(v7)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: v13 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v13 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: v15 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v15
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: PropSet v16, v3 key="label"
// CHECK-NEXT: Jump -> next b5(v16)
// CHECK-NEXT: b5(v18: absent|[[L_1]]):
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="Counting"
// CHECK-NEXT: v21 = PropGet v20 key="made"
// CHECK-NEXT: v22 = Increment v21
// CHECK-NEXT: PropSet v20, v22 key="made"
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: v25 = TypeTest v24 testedType=object
// CHECK-NEXT: Branch v25 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v26):
// CHECK-NEXT: Jump -> next b11(v26)
// CHECK-NEXT: b7(v27):
// CHECK-NEXT: v28 = TypeTest v27 testedType=undefined
// CHECK-NEXT: Branch v28 -> taken b8(| 0), notTaken b12(| 0)
// CHECK-NEXT: b8(v29):
// CHECK-NEXT: v30 = TypeTest v18 testedType=absent
// CHECK-NEXT: Branch v30 -> taken b9(| 0), notTaken b10(| 0)
// CHECK-NEXT: b9(v31):
// CHECK-NEXT: v32 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v32
// CHECK-NEXT: b10(v33):
// CHECK-NEXT: Jump -> next b11(v33)
// CHECK-NEXT: b11(v34):
// CHECK-NEXT: Return v34
// CHECK-NEXT: b12(v35):
// CHECK-NEXT: v36 = NewRuntimeError runtimeError=DerivedConstructorResult name="Counting"
// CHECK-NEXT: Throw v36
// CHECK-NEXT: b13(v37):
// CHECK-NEXT: v38 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v38
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="stores"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_1]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_1]] field=1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Bag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_6]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
