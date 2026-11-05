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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = NewObject layout=[[L_1]]
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v2, v4 layout=[[L_1]]
// CHECK-NEXT: v6 = Data data=[[d_2]]
// CHECK-NEXT: v7 = NewObject -, v0, v6 layout=[[L_3]] fields=[1, 0]
// CHECK-NEXT: v8 = FinishObject v7
// CHECK-NEXT: v9 = NewClosure v2, v8 function=[[f_4]]
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="generated"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Data data=[[d_5]]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = PropGet v3 key="n"
// CHECK-NEXT: v6 = Increment v5
// CHECK-NEXT: PropSet v3, v6 key="n"
// CHECK-NEXT: v8 = Yield v3
// CHECK-NEXT: v9 = ResultAt v8
// CHECK-NEXT: v10 = ResultAt v8 index=1
// CHECK-NEXT: Switch v10 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v1 = String string="by an iterator"
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="once"
// CHECK-NEXT: v3 = Integer integer=50
// CHECK-NEXT: v4 = Call v2, -, v3
// CHECK-NEXT: v5 = PropGet v4 key="hits"
// CHECK-NEXT: v6 = PropGet v5 key=@@iterator
// CHECK-NEXT: v7 = Call v6, v5 calleeKey=@@iterator
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="add"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=1 captures=[{type=env [[L_7]] flags=[IsFromCompiler]}, {type=anything variableName="table"}, {type=anything variableName="list"}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_7]], v1: anything, v2: anything, v3: anything, v4: anything):
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_7]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="made"
// CHECK-NEXT: v7 = Increment v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_7]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="made"
// CHECK-NEXT: PutEnvironmentField v0, v8 layout=[[L_7]]
// CHECK-NEXT: v12 = PropGet v1 key="set"
// CHECK-NEXT: v13 = GetEnvironmentField v0 layout=[[L_7]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="made"
// CHECK-NEXT: v15 = Call v12, v1, v4, v14 calleeKey="set" calleeName="table.set"
// CHECK-NEXT: v16 = PropGet v2 key="push"
// CHECK-NEXT: v17 = Call v16, v2, v4 calleeKey="push" calleeName="list.push"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
