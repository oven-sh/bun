// RUN: lower
// OPTIONS: builtin-modules

// Prints where a stack trace places a list pattern that takes what cannot be iterated: in a catch clause, in the head of a loop, and behind constants in whose place their values are printed.
function pass(value) {
  return value;
}
function fail() {
  throw new Error("fail");
}
function Made() {}
const nothing = null;
const missing = undefined;
const symbol = Symbol("symbol");
const holder = { a: null, f: 5, s: "text", arr: [1], nested: { deep: null }, g() { return { h: 1 }; } };
let five = 5;
let key = "nope";
const inThisFile = /stack-positions-list-patterns-catch/;
function placesOf(error) {
  return String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
}
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", placesOf(error).slice(0, -2).join(" "));
  }
}
show("try { throw nothing; } catch ([a]) {}", () => { try { throw nothing; } catch ([a]) {} });
show("try { throw five; } catch ([a]) {}", () => { try { throw five; } catch ([a]) {} });
show("try { throw nothing; } catch ({ a }) {}", () => { try { throw nothing; } catch ({ a }) {} });
show("try { pass(1); throw nothing; } catch ([a, b]) {}", () => { try { pass(1); throw nothing; } catch ([a, b]) {} });
show("try { throw nothing; } /* c */ catch /* d */ ([a]) {}", () => { try { throw nothing; } /* c */ catch /* d */ ([a]) {} });
show("try { throw [nothing]; } catch ([[a]]) {}", () => { try { throw [nothing]; } catch ([[a]]) {} });
show("try { throw [nothing]; } catch ([{ a }]) {}", () => { try { throw [nothing]; } catch ([{ a }]) {} });
show("try { throw { a: nothing }; } catch ({ a: [b] }) {}", () => { try { throw { a: nothing }; } catch ({ a: [b] }) {} });
show("for (let [a] = nothing; ; ) {}", () => { for (let [a] = nothing; ; ) {} });
show("for (const [a] = nothing; ; ) {}", () => { for (const [a] = nothing; ; ) {} });
show("for (var [a] = nothing; ; ) {}", () => { for (var [a] = nothing; ; ) {} });
show("for (let a = 1, [b] = nothing; ; ) {}", () => { for (let a = 1, [b] = nothing; ; ) {} });
show("for (let a = five, [b] = nothing; ; ) {}", () => { for (let a = five, [b] = nothing; ; ) {} });
show("for (let { a } = nothing; ; ) {}", () => { for (let { a } = nothing; ; ) {} });
show("for (let [[a]] = [nothing]; ; ) {}", () => { for (let [[a]] = [nothing]; ; ) {} });
show("const a1 = 1, [x] = nothing;", () => { const a1 = 1, [x] = nothing; });
show("const a1 = five, [x] = nothing;", () => { const a1 = five, [x] = nothing; });
show("const a1 = \"s\", a2 = 2, [x] = nothing;", () => { const a1 = "s", a2 = 2, [x] = nothing; });
show("let a1 = 1, [x] = nothing;", () => { let a1 = 1, [x] = nothing; });
show("pass(1); const a1 = 1, [x] = nothing;", () => { pass(1); const a1 = 1, [x] = nothing; });
show("const a1 = 1; const [x] = nothing;", () => { const a1 = 1; const [x] = nothing; });
show("const a1 = 1; const a2 = five; const [x] = nothing;", () => { const a1 = 1; const a2 = five; const [x] = nothing; });
show("const a1 = 1; pass(a1); const [x] = nothing;", () => { const a1 = 1; pass(a1); const [x] = nothing; });
show("(function ({ x }) { const a = 1; })(nothing);", () => { (function ({ x }) { const a = 1; })(nothing); });
show("(function ({ x }) { const a = 1, b = \"s\"; })(nothing);", () => { (function ({ x }) { const a = 1, b = "s"; })(nothing); });
show("(function ({ x }) { const a = 1, b = five; })(nothing);", () => { (function ({ x }) { const a = 1, b = five; })(nothing); });
show("(function ({ x }) { const b = five, a = 1; })(nothing);", () => { (function ({ x }) { const b = five, a = 1; })(nothing); });
show("(function ({ x }) { const a = 1; const b = 2; })(nothing);", () => { (function ({ x }) { const a = 1; const b = 2; })(nothing); });
show("(function ({ x }) { pass(1); const a = 1; })(nothing);", () => { (function ({ x }) { pass(1); const a = 1; })(nothing); });
show("(function ({ x }) { let a = 1; })(nothing);", () => { (function ({ x }) { let a = 1; })(nothing); });
show("(function ({ x }) { const a = 1; pass(a); const b = 2; })(nothing);", () => { (function ({ x }) { const a = 1; pass(a); const b = 2; })(nothing); });
show("const a0 = five; const a1 = 1; const [x] = nothing;", () => { const a0 = five; const a1 = 1; const [x] = nothing; });
show("const a1 = 1; const a2 = 2; const [x] = nothing;", () => { const a1 = 1; const a2 = 2; const [x] = nothing; });
show("const a1 = 1; let [x] = nothing;", () => { const a1 = 1; let [x] = nothing; });
show("const a1 = 1; const once = pass(nothing); return once.x;", () => { const a1 = 1; const once = pass(nothing); return once.x; });
show("const once = pass(nothing); const a1 = 1; return once.x;", () => { const once = pass(nothing); const a1 = 1; return once.x; });

// GENERATED: placesOf fail show
// CHECK-LABEL: function {{*}}name="placesOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = PropGet v0 key="stack"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="split"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="\n"
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="split" calleeName="split"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="filter"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v12 = NewClosure function=[[f_4]]
// CHECK-NEXT: v13 = Call v11, v9, v12 calleeKey="filter" calleeName="filter"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="map"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v17 = NewClosure function=[[f_6]]
// CHECK-NEXT: v18 = Call v16, v14, v17 calleeKey="map" calleeName="map"
// CHECK-NEXT: ReturnCall v18 casts=[{declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fail"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRuntimeError runtimeError=LeftOutOfExecutable name="fail"
// CHECK-NEXT: Throw v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Call v1 calleeName="run"
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="| no error"
// CHECK-NEXT: v9 = Call v7, v5, v0, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = String string="|"
// CHECK-NEXT: v17 = PropGet v10 key="constructor"
// CHECK-NEXT: v18 = PropGet v17 key="name"
// CHECK-NEXT: v19 = String string="|"
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v21 = Call v20, -, v10 calleeName="placesOf"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="slice"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v25 = Integer
// CHECK-NEXT: v26 = Integer integer=-2
// CHECK-NEXT: v27 = Call v24, v22, v25, v26 calleeKey="slice" calleeName="slice"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="join"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v31 = String string=" "
// CHECK-NEXT: v32 = Call v30, v28, v31 calleeKey="join" calleeName="join"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v34 = Call v15, v13, v0, v16, v18, v19, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
