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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="a"
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = Convert v9 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v15 calleeName="a"
// CHECK-NEXT: v17 = Call v14, v12, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: RecordRequire module=[[m_7]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_7]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_7]] referrer=[[m_0]]
// CHECK-NEXT: v26 = ModuleNamespace module=[[m_7]]
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="b"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v30 = Call v29, v27 calleeKey="b" calleeName="b"
// CHECK-NEXT: v31 = Call v22, v20, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Builtin builtin=GlobalThis
// CHECK-NEXT: v33 = PropGet v32 key="console" [isFreeName]
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v34 key="log"
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v38 = CheckInitialized v37 name="d"
// CHECK-NEXT: v39 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v40 = Call v38, v39 calleeName="viaImportEquals.d"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v42 = Call v36, v34, v41 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: RecordRequire module=[[m_11]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_11]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_11]] referrer=[[m_0]]
// CHECK-NEXT: v46 = ModuleNamespace module=[[m_11]]
// CHECK-NEXT: v47 = Convert v46 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v48 = Builtin builtin=GlobalThis
// CHECK-NEXT: v49 = PropGet v48 key="console" [isFreeName]
// CHECK-NEXT: v50 = Convert v49 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v51 = PropGet v50 key="log"
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v53 = PropGet v47 key="e"
// CHECK-NEXT: v54 = Convert v53 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v55 = Call v54, v47 calleeKey="e" calleeName="whole.e"
// CHECK-NEXT: v56 = Call v52, v50, v55 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v57 = Undefined
// CHECK-NEXT: Return v57
// CHECK-NEXT: }
