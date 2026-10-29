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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = Builtin builtin=Process
// CHECK-NEXT: v4 = String string="made-up"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|"aix"|"android"|"cygwin"|"darwin"|"freebsd"|"haiku"|"linux"|"netbsd"|"openbsd"|"sunos"|"win32" flags=[IsExpected]}
// CHECK-NEXT: PropSet v3, v5 key="platform" mode=Sloppy
// CHECK-NEXT: v7 = Builtin builtin=Process
// CHECK-NEXT: v8 = TypeTest v7 testedType=undefined|null
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=NotDestructurable name="platform"
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = PropGet v11 key="platform"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|"aix"|"android"|"cygwin"|"darwin"|"freebsd"|"haiku"|"linux"|"netbsd"|"openbsd"|"sunos"|"win32" flags=[IsExpected]}
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = Call v18, v16, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b13():
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = String string="./part."
// CHECK-NEXT: v26 = ToString v13
// CHECK-NEXT: v27 = String string=".cjs"
// CHECK-NEXT: v28 = Strcat v25, v26, v27
// CHECK-NEXT: SwitchString v28 strings=["./part.darwin.cjs", "./part.linux.cjs", "./part.made-up.cjs", "./part.win32.cjs"] -> case b6(), case b7(), case b8(), case b9(), otherwise b10()
// CHECK-NEXT: b6() handler=b13():
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v33 = Convert v32 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b11(v33)
// CHECK-NEXT: b7() handler=b13():
// CHECK-NEXT: RecordRequire module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v38 = Convert v37 declared={type=[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b11(v38)
// CHECK-NEXT: b8() handler=b13():
// CHECK-NEXT: RecordRequire module=[[m_9]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_9]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_9]] referrer=[[m_0]]
// CHECK-NEXT: v42 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v43 = Convert v42 declared={type=[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b11(v43)
// CHECK-NEXT: b9() handler=b13():
// CHECK-NEXT: RecordRequire module=[[m_12]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_12]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_12]] referrer=[[m_0]]
// CHECK-NEXT: v47 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v48 = Convert v47 declared={type=[[L_14]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b11(v48)
// CHECK-NEXT: b10() handler=b13():
// CHECK-NEXT: v49 = RequireDynamic v28 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b11(v49)
// CHECK-NEXT: b11(v50) handler=b13():
// CHECK-NEXT: v51 = Convert v50 declared={type=undefined|null|number|string|symbol|bigint|[[L_15]] flags=[IsExpected]}
// CHECK-NEXT: v52 = PropGet v51 key="name"
// CHECK-NEXT: v53 = Call v24, v22, v52 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12():
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b13() role=CatchHandler:
// CHECK-NEXT: v54 = CatchValue
// CHECK-NEXT: v55 = Builtin builtin=GlobalThis
// CHECK-NEXT: v56 = PropGet v55 key="console" [isFreeName]
// CHECK-NEXT: v57 = Convert v56 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v58 = PropGet v57 key="log"
// CHECK-NEXT: v59 = Convert v58 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v60 = PropGet v54 key="code"
// CHECK-NEXT: v61 = Call v59, v57, v60 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: v62 = Undefined
// CHECK-NEXT: Return v62
// CHECK-NEXT: }
