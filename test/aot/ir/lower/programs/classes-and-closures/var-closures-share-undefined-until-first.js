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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = NewObject -, v0 layout=[[L_1]] fields=[0]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: v4 = ToBoolean v0
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: v7 = NewArray v6 contents=anything
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: v10 = Sub v0, v9
// CHECK-NEXT: v11 = Call v8, -, v10 calleeName="entersAgain"
// CHECK-NEXT: AppendSpread v7, v11
// CHECK-NEXT: v13 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: AppendElement v7, v13
// CHECK-NEXT: Jump -> next b3(v7)
// CHECK-NEXT: b2(v15):
// CHECK-NEXT: v16 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: v17 = NewArray v16 contents=anything
// CHECK-NEXT: Jump -> next b3(v17)
// CHECK-NEXT: b3(v18):
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="generator"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = NewObject -, v2 layout=[[L_4]] fields=[0]
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v5 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: v6 = Yield v5
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Switch v8 cases=[1, 2] -> case b1(), case b2(), otherwise b3()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v7
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Data data=[[d_6]]
// CHECK-NEXT: PutEnvironmentField v3, v9 layout=[[L_4]]
// CHECK-NEXT: v11 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: v12 = Yield v11
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Switch v14 cases=[1, 2] -> case b4(), case b5(), otherwise b6()
// CHECK-NEXT: b4():
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v13
// CHECK-NEXT: b6():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="now"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] captures=[{type=env [[L_7]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_7]]):
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_7]]
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="kind"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_8]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_8]]):
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_8]]
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
