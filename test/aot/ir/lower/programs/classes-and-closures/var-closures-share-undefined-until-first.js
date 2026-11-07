// RUN: lower
// OPTIONS: builtin-modules

// A `var` that closures share holds undefined until its first store. Each function below has a closure that may or may not run in front of that store; every line is what plain Bun prints.
const out = [];
function show(name, value) { out.push(name + ": " + (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value))); }

function storedFirst() { var table = { x: 1 }; function read() { return table.x; } return read; }
show("stored first", storedFirst()());

function hoistedCallInFront() { var seen = read(); var table = { x: 1 }; function read() { return table; } return [seen, read()]; }
show("a hoisted function is called in front of the store", hoistedCallInFront());

function handedOutInFront(take) { take(() => table); var table = { x: 2 }; return () => table; }
let early;
const late = handedOutInFront(f => { early = f(); });
show("a closure is handed out and called in front of the store", [early, late()]);

function keptAndCalledLater(keep) { keep(() => table); var table = { x: 3 }; }
let kept;
keptAndCalledLater(f => { kept = f; });
show("a closure is kept in front of the store and called behind it", kept());

function storeOnOnePath(flag) { if (flag) var table = { x: 4 }; return () => table; }
show("the store stands on one path", [storeOnOnePath(true)(), storeOnOnePath(false)()]);

function storeInTry(fail) { try { var table = fail(); } catch { } return () => table; }
show("the store is left out by a throw", [storeInTry(() => ({ x: 5 }))(), storeInTry(() => { throw new Error("no"); })()]);

function storeInLoop(rounds) { const readers = []; for (let i = 0; i < rounds; i++) { var last = { x: i }; readers.push(() => last.x); } readers.push(() => last); return readers; }
show("the store stands in a loop", [storeInLoop(3).map(f => f()), storeInLoop(0).map(f => f())]);

function closureInOwnInitializer() { var self = (() => () => self)(); return self; }
const own = closureInOwnInitializer();
show("a closure in its own initializer", own() === own);

function initializerReadsItself() { var value = (() => value)(); return () => value; }
show("the initializer reads the binding", initializerReadsItself()());

function declaredTwice() { var table = { x: 6 }; const first = () => table; var table; return [first(), (() => table)()]; }
show("declared twice", declaredTwice());

function storedUndefined() { var table = { x: 7 }; const read = () => table; const before = read(); table = undefined; return [before, read()]; }
show("undefined is stored later", storedUndefined());

function storedUndefinedFirst(pick) { var table = pick ? { x: 8 } : undefined; return () => table; }
show("undefined is what the first store brings", [storedUndefinedFirst(true)(), storedUndefinedFirst(false)()]);

function withoutInitializer() { var table; const read = () => table; const before = read(); table = { x: 9 }; return [before, read()]; }
show("no initializer", withoutInitializer());

function getterInFront() { const holder = { get now() { return table; } }; const before = holder.now; var table = { x: 10 }; return [before, holder.now]; }
show("a getter runs in front of the store", getterInFront());

function defaultParameter(read = () => table) { var table = { x: 11 }; let answer; try { answer = read(); } catch (error) { answer = error.name; } return answer; }
show("a default parameter names another binding", defaultParameter());

function* generator() { const read = () => table; yield read(); var table = { x: 12 }; yield read(); }
show("a generator stops in front of the store", [...generator()]);

async function asynchronous(results) { const read = () => table; results.push(read()); await null; var table = { x: 13 }; results.push(read()); }
const awaited = [];
await asynchronous(awaited);
show("an async function waits in front of the store", awaited);

function labeled(skip) { block: { if (skip) break block; var table = { x: 14 }; } return () => table; }
show("a break leaves in front of the store", [labeled(false)(), labeled(true)()]);

function entersAgain(depth) { var mine = { x: depth }; const read = () => mine.x; return depth ? [read(), ...entersAgain(depth - 1), read()] : [read()]; }
show("each activation has its own", entersAgain(2));

function number() { var count = 0; var step = 2; function next() { count += step; return count; } return next; }
const next = number();
show("numbers", [next(), next(), next()]);

function typeofInFront() { const kind = () => typeof table; const before = kind(); var table = "text"; return [before, kind()]; }
show("typeof in front of the store", typeofInFront());

console.log(out.join("\n"));

// GENERATED: entersAgain generator now kind
// CHECK-LABEL: function {{*}}name="entersAgain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = NewObject layout=[[L_1]]
// CHECK-NEXT: PropDefine v3, v2 key="x"
// CHECK-NEXT: v5 = FinishObject v3
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v7 = NewClosure v6 function=[[f_2]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v9 = ToBoolean v2
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = Call v8 calleeName="read"
// CHECK-NEXT: v12 = NewArray v11 contents=anything
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v14 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: v16 = Sub v14, v15
// CHECK-NEXT: v17 = Call v13, -, v16 calleeName="entersAgain"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: AppendSpread v12, v18
// CHECK-NEXT: v20 = Call v8 calleeName="read"
// CHECK-NEXT: AppendElement v12, v20
// CHECK-NEXT: v22 = Convert v12 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v22)
// CHECK-NEXT: b4(v23):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v24 = Call v8 calleeName="read"
// CHECK-NEXT: v25 = NewArray v24 contents=anything
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v26)
// CHECK-NEXT: b6(v27):
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="generator"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|[[L_1]]> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = NewObject -, v2 layout=[[L_5]] fields=[0]
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v5 = NewClosure v3 function=[[f_6]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6 calleeName="read"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v9 = Yield v8
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Switch v11 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v10
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = Data data=[[d_8]]
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v3, v13 layout=[[L_5]]
// CHECK-NEXT: v15 = Call v6 calleeName="read"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v17 = Yield v16
// CHECK-NEXT: v18 = ResultAt v17
// CHECK-NEXT: v19 = ResultAt v17 index=1
// CHECK-NEXT: Switch v19 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v18
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v18
// CHECK-NEXT: b7():
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="now"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=env [[L_9]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_9]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="kind"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_10]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: env [[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_10]]
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
