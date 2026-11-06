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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="lines"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": this "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = String string="undefined"
// CHECK-NEXT: Jump -> next b14(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v13 = Builtin builtin=Process
// CHECK-NEXT: v14 = StrictEq v12, v13
// CHECK-NEXT: Branch v14 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v16 = String string="process"
// CHECK-NEXT: Jump -> next b14(v16)
// CHECK-NEXT: b8(v17):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="globalThis" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v21 = StrictEq v17, v20
// CHECK-NEXT: Branch v21 -> taken b10(| 0), notTaken b12(| 0)
// CHECK-NEXT: b10(v22):
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v23 = String string="globalThis"
// CHECK-NEXT: Jump -> next b14(v23)
// CHECK-NEXT: b12(v24):
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v25 = TypeOf v24
// CHECK-NEXT: Jump -> next b14(v25)
// CHECK-NEXT: b14(v26):
// CHECK-NEXT: v27 = Add v8, v26
// CHECK-NEXT: v28 = String string=", "
// CHECK-NEXT: v29 = Add v27, v28
// CHECK-NEXT: v30 = PropGet v2 key="length"
// CHECK-NEXT: v31 = Convert v30 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v32 = Add v29, v31
// CHECK-NEXT: v33 = String string=": "
// CHECK-NEXT: v34 = Add v32, v33
// CHECK-NEXT: v35 = Builtin builtin=Array
// CHECK-NEXT: v36 = Builtin builtin=ArrayFrom
// CHECK-NEXT: v37 = NewClosure function=[[f_4]]
// CHECK-NEXT: v38 = Call v36, v35, v2, v37 calleeName="Array.from"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v40 = PropGet v39 key="join"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v42 = Call v41, v39 calleeKey="join" calleeName="join"
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v44 = Add v34, v43
// CHECK-NEXT: v45 = Call v6, v4, v44 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v46 = Undefined
// CHECK-NEXT: Return v46
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.asyncIterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, IsGenerator, HasThis, TakesCallee, HasArgumentCount, HasHiddenRest, IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|AsyncGenerator<undefined|null|string> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: int[0, 4294967295], v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateUnmappedArguments v2, v3
// CHECK-NEXT: InitialYield v4
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v7 = String string="@@asyncIterator"
// CHECK-NEXT: v8 = Convert v0 declared={type=undefined|null|string|[[L_7]]|ArrayBuffer|Blob|ReadableStream|String|TypedArray|URLSearchParams flags=[IsExpected]}
// CHECK-NEXT: v9 = TypeOf v8
// CHECK-NEXT: v10 = Call v6, -, v7, v9, v4 calleeName="seen"
// CHECK-NEXT: v11 = String string="c"
// CHECK-NEXT: v12 = Await v11, v4
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v14 = Yield v13, v4
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Switch v16 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v15
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v15
// CHECK-NEXT: b4():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
