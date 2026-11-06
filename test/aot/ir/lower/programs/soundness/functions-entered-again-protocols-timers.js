// RUN: lower
// OPTIONS: builtin-modules

// Functions entered again by protocols timers and recursion.
const lines = [];
function once(label) {
  let count = 0;
  const state = { label, hits: [] };
  function bump(by) {
    count += by;
    state.hits.push(count);
    return state;
  }
  return bump;
}
const first = once("first");
first(1);
const trigger = { get again() { return once("by a getter")(10); }, valueOf() { return once("by valueOf")(20).hits[0]; }, toString() { return once("by toString")(30).label; }, toJSON() { return once("by toJSON")(40).hits; }, [Symbol.iterator]() { return once("by an iterator")(50).hits[Symbol.iterator](); }, then(resolve) { resolve(once("by then")(60).label); } };
lines.push(trigger.again.label, trigger.again.hits.join(), trigger + 1, `${trigger}`, JSON.stringify({ trigger }), [...trigger].join(), first(2).hits.join());
function setup() {
  const table = new Map();
  const list = [];
  let made = 0;
  return { add(key) { made++; table.set(key, made); list.push(key); return this; }, report() { return made + ":" + [...table].join("|") + ":" + list.join(); } };
}
const a = setup().add("x");
lines.push(a.report());
const again = [1, 2].map(() => setup().add("y").add("z").report());
lines.push(again.join(" "), a.add("w").report());
class Registry {
  static instances = 0;
  static last = null;
  items = [];
  constructor(name) { Registry.instances++; Registry.last = this; this.name = name; }
}
new Registry("one").items.push(1);
const makeRegistry = name => new Registry(name);
setTimeout(makeRegistry, 0, "from a timer");
queueMicrotask(() => makeRegistry("from a job").items.push(2, 3));
Promise.resolve(trigger).then(label => lines.push(label));
process.on("exit", () => { makeRegistry("at exit"); lines.push(Registry.instances + " " + Registry.last.name + " " + Registry.last.items.length); console.log(lines.join("\n")); });
function recursive(depth) {
  const local = { depth, below: null };
  if (depth > 0) local.below = recursive(depth - 1);
  return local;
}
lines.push(JSON.stringify(recursive(2)));
function* generated() { const own = { n: 0 }; for (;;) { own.n++; yield own; } }
const g1 = generated(), g2 = generated();
lines.push([g1.next().value.n, g1.next().value.n, g2.next().value.n, g1.next().value === g2.next().value].join());

// GENERATED: once generated [Symbol.iterator] add
// CHECK-LABEL: function {{*}}name="once"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|[[f_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_2]]
// CHECK-NEXT: v2 = NewClosure v1 function=[[f_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[f_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v5 layout=[[L_2]]
// CHECK-NEXT: v7 = Data data=[[d_4]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v9 = NewObject -, v0 layout=[[L_5]] fields=[1]
// CHECK-NEXT: PropDefine v9, v8 key="hits"
// CHECK-NEXT: v11 = FinishObject v9
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v1, v12 layout=[[L_2]] field=1
// CHECK-NEXT: v14 = Convert v3 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="generated"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|[[L_6]]> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Data data=[[d_7]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = PropGet v4 key="n"
// CHECK-NEXT: v7 = Increment v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v8 key="n"
// CHECK-NEXT: v10 = Yield v4
// CHECK-NEXT: v11 = ResultAt v10
// CHECK-NEXT: v12 = ResultAt v10 index=1
// CHECK-NEXT: Switch v12 cases=[1, 2] -> case b4(), case b5(), otherwise b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v11
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|[[L_8]]|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v1 = String string="by an iterator"
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="once"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=50
// CHECK-NEXT: v5 = Call v3, -, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="hits"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key=@@iterator
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v10, v8 calleeKey=@@iterator
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=undefined|null|[[L_8]]|Generator flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="add"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 captures=[{type=env [[L_11]] flags=[IsFromCompiler]}, {type=undefined|null|Map flags=[IsExpected]}, {type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_12]] flags=[IsExpected]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: env [[L_11]], v1: undefined|null|Map, v2: undefined|null|Array, v3: anything, v4: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_11]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="made"
// CHECK-NEXT: v7 = Increment v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_11]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="made"
// CHECK-NEXT: PutEnvironmentField v0, v8 layout=[[L_11]]
// CHECK-NEXT: v12 = PropGet v1 key="set"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_14]] flags=[IsExpected]}
// CHECK-NEXT: v14 = GetEnvironmentField v0 layout=[[L_11]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="made"
// CHECK-NEXT: v16 = Call v13, v1, v4, v15 calleeKey="set" calleeName="table.set"
// CHECK-NEXT: v17 = PropGet v2 key="push"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[f_15]] flags=[IsExpected]}
// CHECK-NEXT: v19 = Call v18, v2, v4 calleeKey="push" calleeName="list.push"
// CHECK-NEXT: v20 = Convert v3 declared={type=undefined|null|[[L_12]] flags=[IsExpected]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
