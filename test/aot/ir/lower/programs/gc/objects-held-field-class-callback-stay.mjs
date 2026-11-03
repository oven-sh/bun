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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = Integer integer=4
// CHECK-NEXT: v6 = Less v3, v5
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="Promise" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v11 = NewClosure function=[[f_1]]
// CHECK-NEXT: v12 = Construct v10, -, v11 calleeName="Promise"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Promise flags=[IsExpected]}
// CHECK-NEXT: v14 = Await v13
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="Bun" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Bun) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="gc"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(BunGc) flags=[IsExpected]}
// CHECK-NEXT: v20 = Boolean boolean=true
// CHECK-NEXT: v21 = Call v19, v17, v20 calleeKey="gc" calleeName="Bun.gc"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v22 = Increment v7
// CHECK-NEXT: v23 = Convert v22 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v23)
// CHECK-NEXT: b6(v24):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v1 key="keep"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v1 layout=[[L_3]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v0, v5 function=[[f_4]]
// CHECK-NEXT: v7 = Convert v5 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: PrivateSet v7, v0, v2 layout=[[L_3]] field=1
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
