// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// The function that `forEach` calls keeps its third argument, the list, in a constant and stores to that.
const names = ["A", "B"];
names.forEach((name, index, list) => {
  const same = list;
  same[index] = name.toLowerCase();
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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=3 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=number flags=[IsExpected]}, {type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number, v2: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: v3 = PropGet v0 key="toLowerCase"
// CHECK-NEXT: v4 = Call v3, v0 calleeKey="toLowerCase" calleeName="name.toLowerCase"
// CHECK-NEXT: ElemSet v2, v1, v4 mode=Sloppy
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
