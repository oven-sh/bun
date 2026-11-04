// RUN: lower
// OPTIONS: builtin-modules

// What a body that is a generator function, the callback for uncaught exceptions and listeners of the process see as `this` and as their arguments.
const lines = [];
function seen(name, self, given) {
  lines.push(name + ": this " + (self === undefined ? "undefined" : self === process ? "process" : self === globalThis ? "globalThis" : typeof self) + ", " + given.length + ": " + Array.from(given, v => (v instanceof Error ? v.constructor.name : typeof v)).join());
}
lines.push(await new Response(async function* () { seen("body", this, arguments); yield "a"; yield "b"; }).text());
lines.push(await new Response({ async *[Symbol.asyncIterator]() { seen("@@asyncIterator", typeof this, arguments); yield "c"; } }).text());
process.on("uncaughtException", function (error, origin) { seen("uncaughtException", this, arguments); lines.push(origin); });
await new Promise(resolve => { setTimeout(() => { setTimeout(resolve, 5); throw new RangeError("first"); }, 1); });
process.removeAllListeners("uncaughtException");
process.setUncaughtExceptionCaptureCallback(function (error) { seen("capture callback", this, arguments); });
await new Promise(resolve => { setTimeout(() => { setTimeout(resolve, 5); throw new TypeError("second"); }, 1); });
process.setUncaughtExceptionCaptureCallback(null);
process.on("unhandledRejection", function (reason, promise) { seen("unhandledRejection", this, arguments); });
Promise.reject(new EvalError("third"));
await new Promise(resolve => setTimeout(resolve, 5));
process.on("beforeExit", function (code) { seen("beforeExit", this, arguments); });
process.on("exit", function (code) { seen("exit", this, arguments); console.log(lines.join("\n")); });

// GENERATED: seen [Symbol.asyncIterator]
// CHECK-LABEL: function {{*}}name="seen"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=anything}, {type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything, v2: undefined|null|[[L_1]]):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="lines"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = String string=": this "
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: v8 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: v10 = String string="undefined"
// CHECK-NEXT: Jump -> next b7(v10)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: v12 = NarrowByTest v1, v11
// CHECK-NEXT: v13 = Builtin builtin=Process
// CHECK-NEXT: v14 = StrictEq v12, v13
// CHECK-NEXT: Branch v14 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = String string="process"
// CHECK-NEXT: Jump -> next b7(v15)
// CHECK-NEXT: b4():
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="globalThis" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v19 = StrictEq v12, v18
// CHECK-NEXT: Branch v19 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = String string="globalThis"
// CHECK-NEXT: Jump -> next b7(v20)
// CHECK-NEXT: b6():
// CHECK-NEXT: v21 = TypeOf v12
// CHECK-NEXT: Jump -> next b7(v21)
// CHECK-NEXT: b7(v22):
// CHECK-NEXT: v23 = Add v7, v22
// CHECK-NEXT: v24 = String string=", "
// CHECK-NEXT: v25 = Add v23, v24
// CHECK-NEXT: v26 = PropGet v2 key="length"
// CHECK-NEXT: v27 = Add v25, v26
// CHECK-NEXT: v28 = String string=": "
// CHECK-NEXT: v29 = Add v27, v28
// CHECK-NEXT: v30 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v31 = NewClosure function=[[f_3]]
// CHECK-NEXT: v32 = IsPristineArray v2
// CHECK-NEXT: Branch v32 -> taken b8(), notTaken b9()
// CHECK-NEXT: b8():
// CHECK-NEXT: v33 = Builtin builtin=CompilerHelpersArrayFromList [isNotReadFromHolder]
// CHECK-NEXT: v34 = Call v33, -, v2, v31
// CHECK-NEXT: Jump -> next b10(v34)
// CHECK-NEXT: b9():
// CHECK-NEXT: v35 = Builtin builtin=Array [isNotReadFromHolder]
// CHECK-NEXT: v36 = Builtin builtin=ArrayFrom [isNotReadFromHolder]
// CHECK-NEXT: v37 = Call v36, v35, v2, v31
// CHECK-NEXT: Jump -> next b10(v37)
// CHECK-NEXT: b10(v38):
// CHECK-NEXT: v39 = PropGet v38 key="join"
// CHECK-NEXT: v40 = Call v39, v38 calleeKey="join" calleeName="join"
// CHECK-NEXT: v41 = Add v29, v40
// CHECK-NEXT: v42 = Call v5, v4, v41 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v43 = Undefined
// CHECK-NEXT: Return v43
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.asyncIterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, IsGenerator, HasThis, TakesCallee, HasArgumentCount, HasHiddenRest, IsNamedByComputedKey] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: int[0, 4294967295], v3: Array):
// CHECK-NEXT: v4 = CreateUnmappedArguments v2, v3
// CHECK-NEXT: InitialYield v4
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v7 = String string="@@asyncIterator"
// CHECK-NEXT: v8 = TypeOf v0
// CHECK-NEXT: v9 = Call v6, -, v7, v8, v4 calleeName="seen"
// CHECK-NEXT: v10 = String string="c"
// CHECK-NEXT: v11 = Await v10, v4
// CHECK-NEXT: v12 = Yield v11, v4
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Switch v14 cases=[1, 2] -> case b1(), case b2(), otherwise b3()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v13
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
