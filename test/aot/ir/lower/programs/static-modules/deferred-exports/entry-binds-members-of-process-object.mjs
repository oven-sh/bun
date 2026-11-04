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
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="stdout"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ProcessStdout) flags=[IsExpected]}
// CHECK-NEXT: v18 = Builtin builtin=Process
// CHECK-NEXT: v19 = PropGet v18 key="stdout"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ProcessStdout) flags=[IsExpected]}
// CHECK-NEXT: v21 = StrictEq v17, v20
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="stderr"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ProcessStderr) flags=[IsExpected]}
// CHECK-NEXT: v25 = Builtin builtin=Process
// CHECK-NEXT: v26 = PropGet v25 key="stderr"
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(ProcessStderr) flags=[IsExpected]}
// CHECK-NEXT: v28 = StrictEq v24, v27
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="argv"
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v32 = Builtin builtin=Process
// CHECK-NEXT: v33 = PropGet v32 key="argv"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v35 = StrictEq v31, v34
// CHECK-NEXT: v36 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v37 = CheckInitialized v36 name="env"
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(ProcessEnv) flags=[IsExpected]}
// CHECK-NEXT: v39 = Builtin builtin=Process
// CHECK-NEXT: v40 = PropGet v39 key="env"
// CHECK-NEXT: v41 = Convert v40 declared={type=builtin(ProcessEnv) flags=[IsExpected]}
// CHECK-NEXT: v42 = StrictEq v38, v41
// CHECK-NEXT: v43 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v44 = CheckInitialized v43 name="cwd"
// CHECK-NEXT: v45 = Convert v44 declared={type=builtin(ProcessCwd) flags=[IsExpected]}
// CHECK-NEXT: v46 = Call v45 calleeName="cwd"
// CHECK-NEXT: v47 = TypeOf v46
// CHECK-NEXT: v48 = NewArray v21, v28, v35, v42, v47 contents=anything
// CHECK-NEXT: v49 = PropGet v48 key="join"
// CHECK-NEXT: v50 = Call v49, v48 calleeKey="join" calleeName="join"
// CHECK-NEXT: v51 = String string="\n"
// CHECK-NEXT: v52 = Add v50, v51
// CHECK-NEXT: v53 = Call v14, v13, v52 calleeKey="write" calleeName="stdout.write"
// CHECK-NEXT: v54 = Undefined
// CHECK-NEXT: Return v54
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="stdout"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(ProcessStdout) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="write"
// CHECK-NEXT: v4 = String string="tick\n"
// CHECK-NEXT: v5 = Call v3, v2, v4 calleeKey="write" calleeName="stdout.write"
// CHECK-NEXT: ReturnCall v5
// CHECK-NEXT: }
