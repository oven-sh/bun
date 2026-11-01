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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = Data data=[[d_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="forEach"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v7 = NewClosure function=[[f_5]]
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="forEach" calleeName="names.forEach"
// CHECK-NEXT: v9 = IteratorOpen v4
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v11 = IteratorResume v9
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: Branch v12 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b11():
// CHECK-NEXT: v15 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string="./lib/"
// CHECK-NEXT: v22 = Add v21, v15
// CHECK-NEXT: v23 = String string=".cjs"
// CHECK-NEXT: v24 = Add v22, v23
// CHECK-NEXT: SwitchString v24 strings=["./lib/a.cjs", "./lib/b.cjs", "./lib/c.cjs"] -> case b6(), case b7(), case b8(), otherwise b9()
// CHECK-NEXT: b6() handler=b11():
// CHECK-NEXT: RecordRequire module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v29 = Convert v28 declared={type=[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b10(v29)
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: RecordRequire module=[[m_9]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_9]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_9]] referrer=[[m_0]]
// CHECK-NEXT: v33 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v34 = Convert v33 declared={type=[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b10(v34)
// CHECK-NEXT: b8() handler=b11():
// CHECK-NEXT: RecordRequire module=[[m_12]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_12]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_12]] referrer=[[m_0]]
// CHECK-NEXT: v38 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v39 = Convert v38 declared={type=[[L_14]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b10(v39)
// CHECK-NEXT: b9() handler=b11():
// CHECK-NEXT: v40 = RequireDynamic v24 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v40)
// CHECK-NEXT: b10(v41) handler=b11():
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|number|string|symbol|bigint|[[L_15]] flags=[IsExpected]}
// CHECK-NEXT: v43 = PropGet v42 key="who"
// CHECK-NEXT: v44 = Call v20, v18, v43 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b11() role=IterationCleanup subject=v9:
// CHECK-NEXT: v45 = CatchException
// CHECK-NEXT: IteratorClose v9 completion=Throw
// CHECK-NEXT: Rethrow v45
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, TakesCallee, HasArgumentCount, HasHiddenRest] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: function, v1: int[0, 4294967295], v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = CreateMappedArguments v0, v1, v2
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = ElemGet v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = ElemGet v3, v7
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = ElemGet v3, v9
// CHECK-NEXT: v11 = PropGet v10 key="toLowerCase"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12, v10 calleeKey="toLowerCase" calleeName="arguments[0].toLowerCase"
// CHECK-NEXT: ElemSet v6, v8, v13 mode=Sloppy
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_17]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
