// RUN: lower
// OPTIONS: builtin-modules

// The clean-up callback of a registry does not run for an object that a live object refers to, also when no code reads the reference.
async function collect() {
  for (let i = 0; i < 4; i++) {
    await new Promise(done => setTimeout(done, 1));
    Bun.gc(true);
  }
}
async function count(name, make) {
  let cleaned = 0;
  const registry = new FinalizationRegistry(() => cleaned++);
  const holders = [];
  for (let i = 0; i < 500; i++) holders.push(make(i, o => (registry.register(o, i), o)));
  await collect();
  await collect();
  console.log(name, cleaned, holders.length);
}
await count("field", (i, watch) => {
  class Holder {
    constructor(o) {
      this.keep = o;
    }
  }
  return new Holder(watch({ i }));
});
await count("private field", (i, watch) => {
  class Holder {
    #keep;
    constructor(o) {
      this.#keep = o;
    }
  }
  return new Holder(watch({ i }));
});
await count("literal", (i, watch) => ({ keep: watch({ i }) }));
await count("list", (i, watch) => {
  const l = [];
  l.push(watch({ i }));
  return l;
});
await count("subscription", (i, watch) => {
  class Subscription {
    constructor(n) {
      this.n = n;
    }
  }
  class Component {
    constructor() {
      this.subscription = watch(new Subscription(i));
    }
  }
  return new Component();
});

// GENERATED: collect Holder
// CHECK-LABEL: function {{*}}name="collect"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] syntax=[HasWrittenAwait] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v2)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = Integer integer=4
// CHECK-NEXT: v6 = Less v3, v5
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="Promise" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v10 = NewClosure function=[[f_1]]
// CHECK-NEXT: v11 = Construct v9, -, v10 calleeName="Promise"
// CHECK-NEXT: v12 = Await v11
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="Bun" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Bun) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="gc"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(BunGc) flags=[IsExpected]}
// CHECK-NEXT: v18 = Boolean boolean=true
// CHECK-NEXT: v19 = Call v17, v15, v18 calleeKey="gc" calleeName="Bun.gc"
// CHECK-NEXT: v20 = Increment v3
// CHECK-NEXT: v21 = Convert v20 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v21)
// CHECK-NEXT: b3():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_2]]}
// CHECK-NEXT: PropSet v4, v1 key="keep"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: Jump -> next b2(v8)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything, v2: anything):
// CHECK-NEXT: v3 = GetConstructPrototype v1 layout=[[L_3]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]]}
// CHECK-NEXT: v6 = CallDirect v0, v5 function=[[f_4]]
// CHECK-NEXT: PrivateSet v5, v0, v2 layout=[[L_3]] field=1
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b1(| 0), notTaken b2(v5)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: Jump -> next b2(v10)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
