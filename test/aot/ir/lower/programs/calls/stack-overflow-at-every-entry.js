// RUN: lower
// OPTIONS: builtin-modules

let limit = Infinity;

function direct(depth) {
  return depth >= limit ? 0 : depth + direct(depth + 1);
}

function createClosure() {
  const closure = depth => (depth >= limit ? 0 : depth + closure(depth + 1));
  return closure;
}

const methodTarget = {
  sum(depth) {
    return depth >= limit ? 0 : depth + this.sum(depth + 1);
  },
};

const getterTarget = {
  depth: 0,
  get sum() {
    const depth = this.depth;
    if (depth >= limit) return 0;
    this.depth = depth + 1;
    return depth + this.sum;
  },
};

function throughGetter() {
  getterTarget.depth = 0;
  return getterTarget.sum;
}

function throughMap(depth) {
  return depth >= limit ? 0 : [depth].map(value => value + throughMap(value + 1))[0];
}

class Chain {
  constructor(depth) {
    this.sum = depth >= limit ? 0 : depth + new Chain(depth + 1).sum;
  }
}

async function throughAsync(depth) {
  return depth >= limit ? 0 : depth + (await throughAsync(depth + 1));
}

async function check(name, run) {
  limit = Infinity;
  try {
    console.log(name, "returned", await run());
  } catch (error) {
    console.log(name, error.name);
  }
  limit = 3;
  console.log(name, "depth 3:", await run());
  limit = 1000;
  console.log(name, "depth 1000:", await run());
}

async function main() {
  const closure = createClosure();
  await check("direct", () => direct(0));
  await check("closure", () => closure(0));
  await check("method", () => methodTarget.sum(0));
  await check("getter", throughGetter);
  await check("map", () => throughMap(0));
  await check("new", () => new Chain(0).sum);
  await check("async", () => throughAsync(0));
}

main();

// GENERATED: check closure
// CHECK-LABEL: function {{*}}name="check"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="limit"
// CHECK-NEXT: v5 = Double number=Infinity
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v6 variable=[[g_1]]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = String string="returned"
// CHECK-NEXT: v14 = Call v2 calleeName="run"
// CHECK-NEXT: v15 = Await v14, v1, v2
// CHECK-NEXT: v16 = Call v12, v10, v1, v13, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v17 = CatchValue
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v17 key="name"
// CHECK-NEXT: v24 = Call v22, v20, v1, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="limit"
// CHECK-NEXT: v27 = Integer integer=3
// CHECK-NEXT: v28 = Convert v27 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v28 variable=[[g_1]]
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = String string="depth 3:"
// CHECK-NEXT: v36 = Call v2 calleeName="run"
// CHECK-NEXT: v37 = Await v36, v1, v2
// CHECK-NEXT: v38 = Call v34, v32, v1, v35, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v39 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v40 = CheckInitialized v39 name="limit"
// CHECK-NEXT: v41 = Integer integer=1000
// CHECK-NEXT: v42 = Convert v41 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v42 variable=[[g_1]]
// CHECK-NEXT: v44 = Builtin builtin=GlobalThis
// CHECK-NEXT: v45 = PropGet v44 key="console" [isFreeName]
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v47 = PropGet v46 key="log"
// CHECK-NEXT: v48 = Convert v47 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v49 = String string="depth 1000:"
// CHECK-NEXT: v50 = Call v2 calleeName="run"
// CHECK-NEXT: v51 = Await v50, v1, v2
// CHECK-NEXT: v52 = Call v48, v46, v1, v49, v51 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v53 = Undefined
// CHECK-NEXT: Return v53
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="closure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 captures=[{type=env [[L_2]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: env [[L_2]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="limit"
// CHECK-NEXT: v5 = GreaterEq v2, v4
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="closure"
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Add v9, v12
// CHECK-NEXT: v14 = Call v11, -, v13 calleeName="closure"
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v16 = Add v9, v15
// CHECK-NEXT: Jump -> next b6(v16)
// CHECK-NEXT: b6(v17):
// CHECK-NEXT: v18 = Convert v17 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
