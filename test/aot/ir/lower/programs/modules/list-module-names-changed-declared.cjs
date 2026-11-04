// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// The function that `forEach` calls is declared elsewhere.
const names = ["A", "B"];
function lower(name, index, list) {
  list[index] = name.toLowerCase();
}
names.forEach(lower);
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
// CHECK-NEXT: v3 = NewClosure function=[[f_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[f_3]] flags=[IsFromCompiler]}
// CHECK-NEXT: v5 = Data data=[[d_4]]
// CHECK-NEXT: v6 = PropGet v5 key="forEach"
// CHECK-NEXT: v7 = Call v6, v5, v4 calleeKey="forEach" calleeName="names.forEach"
// CHECK-NEXT: v8 = IteratorOpen v5
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v10 = IteratorResume v8
// CHECK-NEXT: v11 = ResultAt v10
// CHECK-NEXT: v12 = ResultAt v10 index=1
// CHECK-NEXT: Branch v11 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b10():
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = String string="./lib/"
// CHECK-NEXT: v20 = Add v19, v12
// CHECK-NEXT: v21 = String string=".cjs"
// CHECK-NEXT: v22 = Add v20, v21
// CHECK-NEXT: SwitchString v22 strings=["./lib/a.cjs", "./lib/b.cjs", "./lib/c.cjs"] -> case b5(), case b6(), case b7(), otherwise b8()
// CHECK-NEXT: b5() handler=b10():
// CHECK-NEXT: RecordRequire module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_5]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v27 = Convert v26 declared={type=[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v27)
// CHECK-NEXT: b6() handler=b10():
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_8]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v32 = Convert v31 declared={type=[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v32)
// CHECK-NEXT: b7() handler=b10():
// CHECK-NEXT: RecordRequire module=[[m_11]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_11]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_11]] referrer=[[m_0]]
// CHECK-NEXT: v36 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v37 = Convert v36 declared={type=[[L_13]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v37)
// CHECK-NEXT: b8() handler=b10():
// CHECK-NEXT: v38 = RequireDynamic v22 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b9(v38)
// CHECK-NEXT: b9(v39) handler=b10():
// CHECK-NEXT: v40 = PropGet v39 key="who"
// CHECK-NEXT: v41 = Call v18, v16, v40 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b10() role=IterationCleanup subject=v8:
// CHECK-NEXT: v42 = CatchException
// CHECK-NEXT: IteratorClose v8 completion=Throw
// CHECK-NEXT: Rethrow v42
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="lower"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: undefined|null|object):
// CHECK-NEXT: v3 = PropGet v0 key="toLowerCase"
// CHECK-NEXT: v4 = Call v3, v0 calleeKey="toLowerCase" calleeName="name.toLowerCase"
// CHECK-NEXT: ElemSet v2, v1, v4 mode=Sloppy
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
