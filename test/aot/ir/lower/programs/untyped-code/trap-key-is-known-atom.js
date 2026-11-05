// RUN: lower
// OPTIONS: builtin-modules

const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const operations = [
    "operationAOTGetByValGeneric", "operationAOTInByValGeneric", "operationAOTPutByValGeneric",
    "operationAOTGetByValAndCache", "operationAOTInByValAndCache", "operationAOTPutByValAndCache", "operationAOTPutByValAndCacheSloppy",
    "operationAOTDeleteByVal", "operationAOTDeleteByValSloppy",
];
const visits = () => operations.reduce((sum, operation) => sum + count(operation), 0);

const log = [];
const handler = {
    get(target, key, receiver) { if (typeof key === "symbol") return target[key]; return key in target ? target[key] : "no " + key; },
    has(target, key) { return key in target; },
    set(target, key, value) { target[key] = value; return true; },
    deleteProperty(target, key) { log.push("delete " + key); return delete target[key]; },
    getOwnPropertyDescriptor(target, key) { log.push("describe " + typeof key); return Reflect.getOwnPropertyDescriptor(target, key); },
    defineProperty(target, key, descriptor) { log.push("define " + key); return Reflect.defineProperty(target, key, descriptor); },
};
const make = n => new Proxy({ alpha: n, beta: n + 1, gamma: n + 2 }, handler);

const one = make(1);
console.log("by name:", one.alpha, one.beta, one.gamma, one.missing);
const names = ["alpha", "beta", "gamma", "missing"];
console.log("by key:", names.map(name => one[name]).join());
console.log("in:", "alpha" in one, "missing" in one, names.map(name => name in one).join());
one.alpha = 10; one.added = 11; one[names[1]] = 12;
console.log("stored:", one.alpha, one.added, one.beta, Object.keys(one).join());
console.log("deleted:", delete one.added, delete one[names[2]], Object.keys(one).join());
Object.defineProperty(one, "defined", { value: 5, configurable: true, enumerable: true, writable: true });
console.log("defined:", one.defined, JSON.stringify(Object.getOwnPropertyDescriptor(one, "defined")), Object.hasOwn(one, "alpha"), log.join(" | "));

const kinds = [];
const curious = new Proxy({}, { get(target, key) { kinds.push(typeof key + ":" + String(key) + ":" + (typeof key === "string" ? key.length : "")); return key; } });
const sameText = curious.alpha === "alpha" && curious["al" + "pha"] === "alpha" && curious.alpha === curious.alpha;
console.log("what the trap is given:", sameText, curious[Symbol.iterator] === Symbol.iterator, curious[7], curious["7"], curious[""], curious.a, curious["é中"], kinds.join(" "));
const held = [];
const keeper = new Proxy({}, { get(target, key) { held.push(key); return 1; } });
for (let i = 0; i < 6; i++) { keeper.alpha; keeper.beta; if (i % 2) collect(); }
collect();
console.log("keys kept across collections:", held.join());
const changed = new Proxy({}, { get(target, key) { return key + "!"; } });
console.log("a key put together with more:", changed.alpha, changed.alpha, changed.beta);

const many = new Proxy({}, { get(target, key) { return key.length; } });
let lengths = 0;
for (let i = 0; i < 300; i++) lengths += many["name" + i] + many["name" + (i % 7)];
console.log("hundreds of names:", lengths);

let total = 0;
const proxies = [make(1), make(2), new Proxy({ beta: 1, alpha: 2 }, handler)];
const round = () => {
    for (const proxy of proxies) {
        total += proxy.alpha + proxy.beta;
        if (proxy.missing !== "no missing") total += 1000000;
        proxy.alpha = total & 7;
    }
};
for (let i = 0; i < 300; i++) round();
const before = visits();
for (let i = 0; i < 2000; i++) round();
const visited = visits() - before;
console.log("the sum:", total);
console.log("the run time is asked at most 300 times under the keys of 24000 traps:", typeof aotOperationCount !== "function" || visited <= 300);

// GENERATED: defineProperty make round
// CHECK-LABEL: function {{*}}name="defineProperty"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|number|string|symbol flags=[IsExpected]}, {type=undefined|null|boolean|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|number|string|symbol, v2: undefined|null|boolean|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="log"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="define "
// CHECK-NEXT: v8 = Add v7, v1
// CHECK-NEXT: v9 = Call v6, v4, v8 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v10 = Builtin builtin=Reflect
// CHECK-NEXT: v11 = Builtin builtin=ReflectDefineProperty
// CHECK-NEXT: v12 = Call v11, v10, v0, v1, v2 calleeName="Reflect.defineProperty"
// CHECK-NEXT: ReturnCall v12 casts=[{declared={type=boolean flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Proxy
// CHECK-NEXT: v2 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Integer integer=2
// CHECK-NEXT: v6 = Add v2, v5
// CHECK-NEXT: v7 = NewObject -, v2, v4, v6 layout=[[L_6]] fields=[0, 1, 2]
// CHECK-NEXT: v8 = FinishObject v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="handler"
// CHECK-NEXT: v11 = Construct v1, -, v8, v10 calleeName="Proxy"
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="round"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="proxies"
// CHECK-NEXT: v2 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v4 = IteratorResume v2
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Branch v5 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b10():
// CHECK-NEXT: v8 = Convert v6 declared={type=undefined|null|number|string|symbol|bigint|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="total"
// CHECK-NEXT: v11 = PropGet v8 key="alpha"
// CHECK-NEXT: v12 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v8 key="beta"
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: v15 = Add v10, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="total"
// CHECK-NEXT: PutModuleVariable v16 variable=[[g_11]]
// CHECK-NEXT: v20 = PropGet v8 key="missing"
// CHECK-NEXT: v21 = String string="no missing"
// CHECK-NEXT: v22 = StrictEq v20, v21
// CHECK-NEXT: Branch v22 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v23) handler=b10():
// CHECK-NEXT: v24 = NarrowByField v8, v23 key="missing"
// CHECK-NEXT: Jump -> next b9(v24)
// CHECK-NEXT: b7(v25) handler=b10():
// CHECK-NEXT: v26 = NarrowByField v8, v25 key="missing"
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b10():
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="total"
// CHECK-NEXT: v29 = Integer integer=1000000
// CHECK-NEXT: v30 = Add v28, v29
// CHECK-NEXT: v31 = Convert v30 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v33 = CheckInitialized v32 name="total"
// CHECK-NEXT: PutModuleVariable v31 variable=[[g_11]]
// CHECK-NEXT: Jump -> next b9(v26)
// CHECK-NEXT: b9(v35) handler=b10():
// CHECK-NEXT: v36 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v37 = CheckInitialized v36 name="total"
// CHECK-NEXT: v38 = Integer integer=7
// CHECK-NEXT: v39 = BitAnd v37, v38
// CHECK-NEXT: PropSet v35, v39 key="alpha"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b10() role=IterationCleanup subject=v2:
// CHECK-NEXT: v41 = CatchException
// CHECK-NEXT: IteratorClose v2 completion=Throw
// CHECK-NEXT: Rethrow v41
// CHECK-NEXT: }
