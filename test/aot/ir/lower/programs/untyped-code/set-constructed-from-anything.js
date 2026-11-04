// RUN: lower
// OPTIONS: builtin-modules

// `new Set(x)`: arrays of every kind, other iterables, what is not iterable, and what can be observed of the construction.
const lines = [];
function say(label, work) {
  let text;
  try {
    text = JSON.stringify(work());
  } catch (error) {
    text = "throws " + error.constructor.name;
  }
  lines.push(label + ": " + text);
}
function make(items) {
  return new Set(items);
}
const show = set => [set instanceof Set, set.size, [...set]];

const object = { id: 1 };
const long = Array.from({ length: 500 }, (_, i) => i % 300);
const sparse = [];
sparse[2000] = "far";
for (let turn = 0; turn < 3; turn++) {
  say("strings " + turn, () => show(make(["http:", "https:", "mailto:", "tel:"])));
  say("integers " + turn, () => show(make([3, 1, 2, 3, 1, turn])));
  say("fractions " + turn, () => show(make([0.5, 1.5, 0.5, turn + 0.25])));
  say("mixed " + turn, () => show(make(["a", 1, "1", 1.0, null, undefined, null, true, object, object, { id: 1 }])));
  say("empty " + turn, () => show(make([])));
}
say("zeros and NaN", () => { const set = make([0, -0, NaN, NaN, 0 / 1]); return [set.size, Object.is([...set][0], 0), set.has(-0), set.has(NaN)]; });
say("holes", () => show(make([1, , 3, , undefined])));
say("holes among fractions", () => show(make([0.5, , 1.5])));
say("only holes", () => show(make(new Array(4))));
say("a long array", () => { const set = make(long); return [set.size, set.has(299), set.has(300), [...set].slice(-2)]; });
say("a sparse array", () => { const set = make(sparse); return [set.size, set.has("far"), set.has(undefined)]; });
say("ropes and parts of strings", () => { const left = "ab" + lines.length; return show(make([left + "c", (left + "cd").slice(0, -1), "x" + left])).slice(1, 2); });
say("big integers and symbols", () => { const symbol = Symbol("s"); const set = make([1n, 1n, 2n ** 70n, 2n ** 70n, symbol, symbol, Symbol("s")]); return set.size; });
say("the order of insertion", () => [...make(["b", "a", "c", "a", "b", "d"])]);
say("the array is not kept", () => { const array = [1, 2]; const set = make(array); array.push(3); set.add(4); return [array, [...set]]; });
say("a frozen array", () => show(make(Object.freeze([1, 2, 2]))));
say("an array with a name on it", () => show(make(Object.assign([1, 2], { extra: 3 }))));

say("nothing", () => [show(new Set()), show(make(undefined)), show(make(null))]);
say("more arguments", () => show(new Set([1, 2], [3, 4])));
say("a string", () => show(make("hello")));
say("a set", () => { const first = make([1, 2]); const second = make(first); second.add(3); return [show(first), show(second)]; });
say("a map", () => show(make(new Map([["a", 1]]))));
say("the keys of a map", () => show(make(new Map([["a", 1], ["b", 2]]).keys())));
say("a typed array", () => show(make(new Uint8Array([1, 2, 1]))));
say("arguments", () => (function () { return show(make(arguments)); })(1, 1, 2));
say("a generator", () => show(make((function* () { yield 1; yield 1; yield 2; })())));
say("an iterable of my own", () => { let left = 3; return show(make({ [Symbol.iterator]() { return { next: () => ({ done: left === 0, value: left-- }) }; } })); });
for (const [name, value] of Object.entries({ "a number": 5, "true": true, "an object": {}, "a function": () => {}, "what is like an array": { length: 2, 0: "a", 1: "b" } })) say(name, () => show(make(value)));
say("a symbol", () => make(Symbol("s")));

class Stack extends Array {}
say("a subclass of Array", () => show(make(Stack.from([1, 1, 2]))));
say("a subclass with an iterator of its own", () => { class Odd extends Array { *[Symbol.iterator]() { yield "odd"; } } return show(make(Odd.from([1, 2]))); });
say("an array with an iterator of its own", () => { const array = [1, 2]; array[Symbol.iterator] = function* () { yield "own"; }; return show(make(array)); });
say("an array under another prototype", () => { const array = Object.setPrototypeOf([1, 2], { [Symbol.iterator]: function* () { yield "other"; } }); return show(make(array)); });
say("an array that is not iterable", () => make(Object.setPrototypeOf([1, 2], null)));
say("an accessor at an index", () => { const order = []; const array = [1, 2, 3]; Object.defineProperty(array, 1, { get() { order.push("read"); array.length = 2; return "got"; } }); return [show(make(array)), order]; });
say("a proxy of an array", () => { const asked = []; const set = make(new Proxy([1, 2], { get(target, key, receiver) { asked.push(String(key)); return Reflect.get(target, key, receiver); } })); return [show(set), asked]; });

class Counted extends Set {
  constructor(items) {
    super(items);
    this.made = true;
  }
  add(item) {
    Counted.added.push(item);
    return super.add(item);
  }
}
Counted.added = [];
say("a subclass of Set with an add of its own", () => { const set = new Counted([1, 2, 2]); return [set.made, set.size, Counted.added, set instanceof Counted]; });
say("Reflect.construct", () => { const set = Reflect.construct(Set, [[1, 2]], Counted); return [set instanceof Counted, set.size, Counted.added.length]; });
say("called without new", () => Set([1]));
say("held in a variable", () => { const Held = Set; return show(new Held([1, 1, 2])); });

console.log(lines.join("\n"));

// GENERATED: make show Stack Counted add
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: v1 = Builtin builtin=Set
// CHECK-NEXT: v2 = Construct v1, -, v0 calleeName="Set"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|Set flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Set):
// CHECK-NEXT: v1 = Builtin builtin=Set
// CHECK-NEXT: v2 = InstanceOf v0, v1
// CHECK-NEXT: v3 = PropGet v0 key="size"
// CHECK-NEXT: v4 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v4, v0
// CHECK-NEXT: v6 = NewArray v2, v3, v4 contents=anything
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Stack"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Counted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|Array):
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_2]]}
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b11(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: v13 = Boolean boolean=true
// CHECK-NEXT: PropSet v12, v13 key="made"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: v16 = TypeTest v15 testedType=object
// CHECK-NEXT: Branch v16 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v17):
// CHECK-NEXT: Jump -> next b9(v17)
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: v19 = TypeTest v18 testedType=undefined
// CHECK-NEXT: Branch v19 -> taken b6(| 0), notTaken b10(| 0)
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: v21 = TypeTest v12 testedType=absent
// CHECK-NEXT: Branch v21 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v22):
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b8(v24):
// CHECK-NEXT: Jump -> next b9(v24)
// CHECK-NEXT: b9(v25):
// CHECK-NEXT: Return v25
// CHECK-NEXT: b10(v26):
// CHECK-NEXT: v27 = NewRuntimeError runtimeError=DerivedConstructorResult name="Counted"
// CHECK-NEXT: Throw v27
// CHECK-NEXT: b11(v28):
// CHECK-NEXT: v29 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="add"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_2]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_2]], v1: anything):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="Counted"
// CHECK-NEXT: v4 = PropGet v3 key="added"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Call v5, v4, v1 calleeKey="push" calleeName="Counted.added.push"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v8 = GetSuperBase v7 homeKind=ClassPrototype
// CHECK-NEXT: v9 = SuperGet v8, v0 key="add"
// CHECK-NEXT: v10 = Call v9, v0, v1 calleeName="super.add"
// CHECK-NEXT: ReturnCall v10
// CHECK-NEXT: }
