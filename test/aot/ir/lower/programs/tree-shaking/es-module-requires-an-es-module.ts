// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5

// FILE: main.ts
// `require` in a TypeScript file that is an ES module itself, import.meta.require, and `import x = require()`.
import viaImportEquals = require("./d");

const { a } = require("./a");
console.log(a());
console.log(import.meta.require("./b").b());
console.log(viaImportEquals.d());
const whole = require("./e");
console.log(whole["e" + ""]());

// FILE: a.ts
export function a() { return "a: require"; }
export function unused() { return "unused"; }

// FILE: b.ts
export function b() { return "b: import.meta.require"; }

// FILE: c.ts
export function c() { return "c: createRequire"; }

// FILE: d.ts
export function d() { return "d: import = require"; }

// FILE: e.ts
export function e() { return "e: a computed name"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="a"
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="console" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="log"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v14 = Call v8 calleeName="a"
// CHECK-NEXT: v15 = Call v13, v11, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: RecordRequire module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: v24 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v25 = PropGet v24 key="b"
// CHECK-NEXT: v26 = Call v25, v24 calleeKey="b" calleeName="b"
// CHECK-NEXT: v27 = Call v20, v18, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v28 = Builtin builtin=GlobalThis
// CHECK-NEXT: v29 = PropGet v28 key="console" [isFreeName]
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v30 key="log"
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v33 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v34 = CheckInitialized v33 name="d"
// CHECK-NEXT: v35 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v36 = Call v34, v35 calleeName="viaImportEquals.d"
// CHECK-NEXT: v37 = Call v32, v30, v36 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_8]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: v41 = ModuleNamespace module=[[m_8]]
// CHECK-NEXT: v42 = Builtin builtin=GlobalThis
// CHECK-NEXT: v43 = PropGet v42 key="console" [isFreeName]
// CHECK-NEXT: v44 = Convert v43 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v45 = PropGet v44 key="log"
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v47 = PropGet v41 key="e"
// CHECK-NEXT: v48 = Call v47, v41 calleeKey="e"
// CHECK-NEXT: v49 = Call v46, v44, v48 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v50 = Undefined
// CHECK-NEXT: Return v50
// CHECK-NEXT: }
