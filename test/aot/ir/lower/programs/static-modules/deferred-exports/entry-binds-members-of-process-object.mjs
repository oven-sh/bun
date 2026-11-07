// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.mjs
// The entry point binds members of the process object.
import { stdout, stderr, argv, env, cwd, nextTick } from "node:process";
nextTick(() => stdout.write("tick\n"));
stdout.write([stdout === process.stdout, stderr === process.stderr, argv === process.argv, env === process.env, typeof cwd()].join() + "\n");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="nextTick"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ProcessNextTick) flags=[IsExpected]}
// CHECK-NEXT: v9 = NewClosure function=[[f_7]]
// CHECK-NEXT: v10 = Call v8, -, v9 calleeName="nextTick"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="stdout"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(ProcessStdout) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="write"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="stdout"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ProcessStdout) flags=[IsExpected]}
// CHECK-NEXT: v19 = Builtin builtin=Process
// CHECK-NEXT: v20 = PropGet v19 key="stdout"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ProcessStdout) flags=[IsExpected]}
// CHECK-NEXT: v22 = StrictEq v18, v21
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="stderr"
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(ProcessStderr) flags=[IsExpected]}
// CHECK-NEXT: v26 = Builtin builtin=Process
// CHECK-NEXT: v27 = PropGet v26 key="stderr"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(ProcessStderr) flags=[IsExpected]}
// CHECK-NEXT: v29 = StrictEq v25, v28
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v31 = CheckInitialized v30 name="argv"
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v33 = Builtin builtin=Process
// CHECK-NEXT: v34 = PropGet v33 key="argv"
// CHECK-NEXT: v35 = Convert v34 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v36 = StrictEq v32, v35
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v38 = CheckInitialized v37 name="env"
// CHECK-NEXT: v39 = Convert v38 declared={type=builtin(ProcessEnv) flags=[IsExpected]}
// CHECK-NEXT: v40 = Builtin builtin=Process
// CHECK-NEXT: v41 = PropGet v40 key="env"
// CHECK-NEXT: v42 = Convert v41 declared={type=builtin(ProcessEnv) flags=[IsExpected]}
// CHECK-NEXT: v43 = StrictEq v39, v42
// CHECK-NEXT: v44 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v45 = CheckInitialized v44 name="cwd"
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(ProcessCwd) flags=[IsExpected]}
// CHECK-NEXT: v47 = Call v46 calleeName="cwd"
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v49 = TypeOf v48
// CHECK-NEXT: v50 = NewArray v22, v29, v36, v43, v49 contents=undefined|null|boolean|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"
// CHECK-NEXT: v51 = Convert v50 declared={type=undefined|null|Array<undefined|null|boolean|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[IsExpected]}
// CHECK-NEXT: v52 = PropGet v51 key="join"
// CHECK-NEXT: v53 = Convert v52 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v54 = Call v53, v51 calleeKey="join" calleeName="join"
// CHECK-NEXT: v55 = Convert v54 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v56 = String string="\n"
// CHECK-NEXT: v57 = Add v55, v56
// CHECK-NEXT: v58 = Call v15, v13, v57 calleeKey="write" calleeName="stdout.write"
// CHECK-NEXT: v59 = Undefined
// CHECK-NEXT: Return v59
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="stdout"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(ProcessStdout) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="write"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="tick\n"
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="write" calleeName="stdout.write"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=boolean flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
