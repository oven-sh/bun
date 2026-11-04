// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.js
// require() and import() inside functions that nobody calls load nothing. The same calls inside a function that is called load their files then, and what they return is whole.
function neverRequires() { return require("./never-required.js"); }
const neverImports = () => import("./never-imported.js");
function requires() { return require("./required.js"); }
async function imports() { return import("./imported.js"); }

console.log("before");
console.log(requires()["na" + "me"]());
console.log((await imports())["na" + "me"]());

// FILE: imported.js
console.log("imported.js is evaluated");
export function name() { return "imported"; }

// FILE: never-imported.js
console.log("never-imported.js is evaluated");
export function name() { return "never imported"; }

// FILE: never-required.js
console.log("never-required.js is evaluated");
export function name() { return "never required"; }

// FILE: required.js
console.log("required.js is evaluated");
export function name() { return "required"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[f_2]] flags=[IsFromCompiler]}
// CHECK-NEXT: v4 = NewClosure function=[[f_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[f_3]] flags=[IsFromCompiler]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = String string="before"
// CHECK-NEXT: v12 = Call v10, v8, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = Call v3 calleeName="requires"
// CHECK-NEXT: v19 = PropGet v18 key="name"
// CHECK-NEXT: v20 = Call v19, v18 calleeKey="name"
// CHECK-NEXT: v21 = Call v17, v15, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="console" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="log"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v27 = Call v5 calleeName="imports"
// CHECK-NEXT: v28 = Await v27
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: v30 = Call v29, v28 calleeKey="name"
// CHECK-NEXT: v31 = Call v26, v24, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="neverRequires"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewRuntimeError runtimeError=LeftOutOfExecutable name="neverRequires"
// CHECK-NEXT: Throw v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="requires"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: RecordRequire module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: v3 = ModuleNamespace module=[[m_4]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="imports"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = ImportModule module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
