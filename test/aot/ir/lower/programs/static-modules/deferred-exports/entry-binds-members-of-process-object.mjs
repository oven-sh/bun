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
// CHECK-NEXT: v1 = CheckInitialized v0 name="nextTick"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(ProcessNextTick) flags=[IsExpected]}
// CHECK-NEXT: v3 = NewClosure function=[[f_2]]
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="nextTick"
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="stdout"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ProcessStdout) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="write"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="stdout"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ProcessStdout) flags=[IsExpected]}
// CHECK-NEXT: v13 = Builtin builtin=Process
// CHECK-NEXT: v14 = PropGet v13 key="stdout"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ProcessStdout) flags=[IsExpected]}
// CHECK-NEXT: v16 = StrictEq v12, v15
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="stderr"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ProcessStderr) flags=[IsExpected]}
// CHECK-NEXT: v20 = Builtin builtin=Process
// CHECK-NEXT: v21 = PropGet v20 key="stderr"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ProcessStderr) flags=[IsExpected]}
// CHECK-NEXT: v23 = StrictEq v19, v22
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v25 = CheckInitialized v24 name="argv"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v27 = Builtin builtin=Process
// CHECK-NEXT: v28 = PropGet v27 key="argv"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v30 = StrictEq v26, v29
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v32 = CheckInitialized v31 name="env"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(ProcessEnv) flags=[IsExpected]}
// CHECK-NEXT: v34 = Builtin builtin=Process
// CHECK-NEXT: v35 = PropGet v34 key="env"
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(ProcessEnv) flags=[IsExpected]}
// CHECK-NEXT: v37 = StrictEq v33, v36
// CHECK-NEXT: v38 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v39 = CheckInitialized v38 name="cwd"
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(ProcessCwd) flags=[IsExpected]}
// CHECK-NEXT: v41 = Call v40 calleeName="cwd"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v43 = TypeOf v42
// CHECK-NEXT: v44 = NewArray v16, v23, v30, v37, v43 contents=undefined|null|boolean|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"
// CHECK-NEXT: v45 = Convert v44 declared={type=undefined|null|Array<undefined|null|boolean|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"> flags=[IsExpected]}
// CHECK-NEXT: v46 = PropGet v45 key="join"
// CHECK-NEXT: v47 = Convert v46 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v48 = Call v47, v45 calleeKey="join" calleeName="join"
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v50 = String string="\n"
// CHECK-NEXT: v51 = Add v49, v50
// CHECK-NEXT: v52 = Call v9, v7, v51 calleeKey="write" calleeName="stdout.write"
// CHECK-NEXT: v53 = Undefined
// CHECK-NEXT: Return v53
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="stdout"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(ProcessStdout) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="write"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
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
