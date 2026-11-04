// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.cjs
// The program assigns a name of its own to process.platform, takes it out of process by a pattern and names a file by it.
// In such a name the build takes the platform for the one that the executable is built for, so the executable holds that file and not the other, and require() says that it did not find it.
process.platform = "made-up";
const { platform } = process;
console.log(platform);
try {
  console.log(require(`./part.${platform}.cjs`).name);
} catch (error) {
  console.log(error.code);
}

// FILE: part.darwin.cjs
exports.name = "darwin";

// FILE: part.linux.cjs
exports.name = "linux";

// FILE: part.made-up.cjs
exports.name = "made-up";

// FILE: part.win32.cjs
exports.name = "win32";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = Builtin builtin=Process
// CHECK-NEXT: v4 = String string="made-up"
// CHECK-NEXT: PropSet v3, v4 key="platform" mode=Sloppy
// CHECK-NEXT: v6 = Builtin builtin=Process
// CHECK-NEXT: v7 = TypeTest v6 testedType=undefined|null
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = NewRuntimeError runtimeError=NotDestructurable name="platform"
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = PropGet v10 key="platform"
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v16, v14, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b10():
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = String string="./part."
// CHECK-NEXT: v24 = ToString v11
// CHECK-NEXT: v25 = String string=".cjs"
// CHECK-NEXT: v26 = Strcat v23, v24, v25
// CHECK-NEXT: SwitchString v26 strings=["./part.darwin.cjs", "./part.linux.cjs", "./part.made-up.cjs", "./part.win32.cjs"] -> case b4(), case b5(), case b6(), case b7(), otherwise b8()
// CHECK-NEXT: b4() handler=b10():
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v31 = Convert v30 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v31)
// CHECK-NEXT: b5() handler=b10():
// CHECK-NEXT: RecordRequire module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: v35 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v36 = Convert v35 declared={type=[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v36)
// CHECK-NEXT: b6() handler=b10():
// CHECK-NEXT: RecordRequire module=[[m_9]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_9]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_9]] referrer=[[m_0]]
// CHECK-NEXT: v40 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v41 = Convert v40 declared={type=[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v41)
// CHECK-NEXT: b7() handler=b10():
// CHECK-NEXT: RecordRequire module=[[m_12]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_12]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_12]] referrer=[[m_0]]
// CHECK-NEXT: v45 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v46 = Convert v45 declared={type=[[L_14]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v46)
// CHECK-NEXT: b8() handler=b10():
// CHECK-NEXT: v47 = RequireDynamic v26 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b9(v47)
// CHECK-NEXT: b9(v48) handler=b10():
// CHECK-NEXT: v49 = PropGet v48 key="name"
// CHECK-NEXT: v50 = Call v22, v20, v49 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b10() role=CatchHandler:
// CHECK-NEXT: v51 = CatchValue
// CHECK-NEXT: v52 = Builtin builtin=GlobalThis
// CHECK-NEXT: v53 = PropGet v52 key="console" [isFreeName]
// CHECK-NEXT: v54 = Convert v53 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v55 = PropGet v54 key="log"
// CHECK-NEXT: v56 = Convert v55 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v57 = PropGet v51 key="code"
// CHECK-NEXT: v58 = Call v56, v54, v57 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v59 = Undefined
// CHECK-NEXT: Return v59
// CHECK-NEXT: }
