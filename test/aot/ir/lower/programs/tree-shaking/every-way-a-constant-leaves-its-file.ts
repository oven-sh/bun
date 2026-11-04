// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// Each constant, class and enum of values.ts is named in its own file only by the export that hands it out. It is used here once, each through another kind of export and import. Beside each stands one that nobody imports.
import byDefault, { direct, renamed, "quoted name" as quoted, Klass, Kind, fromPattern, fromArray } from "./values";
import { viaStar, viaNamedBarrel, inner } from "./barrel";
import * as values from "./values";
import viaImportEquals = require("./values");

console.log(byDefault.kind, direct, renamed, quoted, new Klass().name(), Kind.A, fromPattern, fromArray);
console.log(viaStar, viaNamedBarrel, inner.viaNamespaceExport);
console.log(values.viaNamespace, viaImportEquals.viaImportEquals, require("./values").viaRequire, (await import("./values")).viaImportCall);

// FILE: barrel.ts
export * from "./values";
export { forNamedBarrel as viaNamedBarrel } from "./values";
export * as inner from "./values";

// FILE: values.ts
export const direct = "direct";
export const directUnused = "unused";
const local = "renamed";
const localUnused = "unused";
export { local as renamed, localUnused as renamedUnused };
const spaced = "quoted";
export { spaced as "quoted name" };
export class Klass { name() { return "Klass"; } }
export class KlassUnused {}
export enum Kind { A = "a" }
export enum KindUnused { A = "a" }
export const { fromPattern, fromPatternUnused } = { fromPattern: "from a pattern", fromPatternUnused: 1 };
export const [fromArray] = ["from an array pattern"];
const theDefault = { kind: "default" };
export default theDefault;
export const viaStar = "through export *";
export const forNamedBarrel = "through a named re-export";
export const viaNamespaceExport = "through export * as";
export const viaNamespace = "through a namespace import";
export const viaImportEquals = "through import = require";
export const viaRequire = "through require";
export const viaImportCall = "through import()";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="byDefault"
// CHECK-NEXT: v11 = PropGet v10 key="kind"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="direct"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="renamed"
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="quoted"
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="Klass"
// CHECK-NEXT: v20 = Construct v19 calleeName="Klass"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[L_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v22 = PropGet v21 key="name"
// CHECK-NEXT: v23 = Call v22, v21 calleeKey="name" calleeName="name"
// CHECK-NEXT: v24 = String string="a"
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="fromPattern"
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="fromArray"
// CHECK-NEXT: v29 = Call v8, v6, v11, v13, v15, v17, v23, v24, v26, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v36 = CheckInitialized v35 name="viaStar"
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v38 = CheckInitialized v37 name="viaNamedBarrel"
// CHECK-NEXT: v39 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v40 = CheckInitialized v39 name="viaNamespaceExport"
// CHECK-NEXT: v41 = Call v34, v32, v36, v38, v40 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v42 = Builtin builtin=GlobalThis
// CHECK-NEXT: v43 = PropGet v42 key="console" [isFreeName]
// CHECK-NEXT: v44 = Convert v43 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v45 = PropGet v44 key="log"
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v47 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v48 = CheckInitialized v47 name="viaNamespace"
// CHECK-NEXT: v49 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v50 = CheckInitialized v49 name="viaImportEquals"
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v54 = Boolean boolean=true
// CHECK-NEXT: v55 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v56 = CheckInitialized v55 name="viaRequire"
// CHECK-NEXT: v57 = ImportModule module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v58 = Await v57
// CHECK-NEXT: v59 = PropGet v58 key="viaImportCall"
// CHECK-NEXT: v60 = Call v46, v44, v48, v50, v56, v59 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v61 = Undefined
// CHECK-NEXT: Return v61
// CHECK-NEXT: }
