// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// The function that `forEach` calls finds the list in `arguments`.
const names = ["A", "B"];
names.forEach(function () {
  arguments[2][arguments[1]] = arguments[0].toLowerCase();
});
for (const name of names) console.log(require("./lib/" + name + ".cjs").who);

// FILE: lib/a.cjs
exports.who = "lib/a";

// FILE: lib/b.cjs
exports.who = "lib/b";

// FILE: lib/c.cjs
exports.who = "lib/c";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = Data data=[[d_3]]
// CHECK-NEXT: v4 = PropGet v3 key="forEach"
// CHECK-NEXT: v5 = NewClosure function=[[f_4]]
// CHECK-NEXT: v6 = Call v4, v3, v5 calleeKey="forEach" calleeName="names.forEach"
// CHECK-NEXT: v7 = IteratorOpen v3
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = IteratorResume v7
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Branch v10 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b10():
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = String string="./lib/"
// CHECK-NEXT: v19 = Add v18, v11
// CHECK-NEXT: v20 = String string=".cjs"
// CHECK-NEXT: v21 = Add v19, v20
// CHECK-NEXT: SwitchString v21 strings=["./lib/a.cjs", "./lib/b.cjs", "./lib/c.cjs"] -> case b5(), case b6(), case b7(), otherwise b8()
// CHECK-NEXT: b5() handler=b10():
// CHECK-NEXT: RecordRequire module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_5]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v26 = Convert v25 declared={type=[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v26)
// CHECK-NEXT: b6() handler=b10():
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_8]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v31 = Convert v30 declared={type=[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v31)
// CHECK-NEXT: b7() handler=b10():
// CHECK-NEXT: RecordRequire module=[[m_11]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_11]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_11]] referrer=[[m_0]]
// CHECK-NEXT: v35 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v36 = Convert v35 declared={type=[[L_13]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v36)
// CHECK-NEXT: b8() handler=b10():
// CHECK-NEXT: v37 = RequireDynamic v21 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b9(v37)
// CHECK-NEXT: b9(v38) handler=b10():
// CHECK-NEXT: v39 = PropGet v38 key="who"
// CHECK-NEXT: v40 = Call v17, v15, v39 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b10() role=IterationCleanup subject=v7:
// CHECK-NEXT: v41 = CatchException
// CHECK-NEXT: IteratorClose v7 completion=Throw
// CHECK-NEXT: Rethrow v41
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, TakesCallee, HasArgumentCount, HasHiddenRest] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function, v1: int[0, 4294967295], v2: Array):
// CHECK-NEXT: v3 = CreateMappedArguments v0, v1, v2
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = ElemGet v3, v4
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = ElemGet v3, v6
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = ElemGet v3, v8
// CHECK-NEXT: v10 = PropGet v9 key="toLowerCase"
// CHECK-NEXT: v11 = Call v10, v9 calleeKey="toLowerCase" calleeName="arguments[0].toLowerCase"
// CHECK-NEXT: ElemSet v5, v7, v11 mode=Sloppy
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
