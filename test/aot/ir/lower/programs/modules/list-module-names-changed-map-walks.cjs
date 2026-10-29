// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// The list is a literal that `map` walks. The function stores to a later element, which `map` then hands to it.
const mapped = ["a", "b"].map((name, index, list) => {
  list[1] = "c";
  return name;
});
for (const name of mapped) console.log(require("./lib/" + name + ".cjs").who);

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
// CHECK-NEXT: v5 = PropGet v4 key="map"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v7 = NewClosure function=[[f_5]]
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="map" calleeName="map"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v10 = IteratorOpen v9
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = IteratorResume v10
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Branch v13 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b11():
// CHECK-NEXT: v16 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = String string="./lib/"
// CHECK-NEXT: v23 = Add v22, v16
// CHECK-NEXT: v24 = String string=".cjs"
// CHECK-NEXT: v25 = Add v23, v24
// CHECK-NEXT: SwitchString v25 strings=["./lib/a.cjs", "./lib/b.cjs", "./lib/c.cjs"] -> case b6(), case b7(), case b8(), otherwise b9()
// CHECK-NEXT: b6() handler=b11():
// CHECK-NEXT: RecordRequire module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v30 = Convert v29 declared={type=[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b10(v30)
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: RecordRequire module=[[m_9]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_9]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_9]] referrer=[[m_0]]
// CHECK-NEXT: v34 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v35 = Convert v34 declared={type=[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b10(v35)
// CHECK-NEXT: b8() handler=b11():
// CHECK-NEXT: RecordRequire module=[[m_12]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_12]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_12]] referrer=[[m_0]]
// CHECK-NEXT: v39 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v40 = Convert v39 declared={type=[[L_14]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b10(v40)
// CHECK-NEXT: b9() handler=b11():
// CHECK-NEXT: v41 = RequireDynamic v25 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v41)
// CHECK-NEXT: b10(v42) handler=b11():
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|number|string|symbol|bigint|[[L_15]] flags=[IsExpected]}
// CHECK-NEXT: v44 = PropGet v43 key="who"
// CHECK-NEXT: v45 = Call v21, v19, v44 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b11() role=IterationCleanup subject=v10:
// CHECK-NEXT: v46 = CatchException
// CHECK-NEXT: IteratorClose v10 completion=Throw
// CHECK-NEXT: Rethrow v46
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=3 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=number flags=[IsExpected]}, {type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number, v2: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = String string="c"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: ElemSet v2, v3, v5 mode=Sloppy
// CHECK-NEXT: v7 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_17]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
