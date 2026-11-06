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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
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
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_3]]} illTypedCause=Assertion
// CHECK-NEXT: v12 = PropGet v11 key="kind"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="direct"
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="renamed"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="quoted"
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="Klass"
// CHECK-NEXT: v21 = Construct v20 calleeName="Klass"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[L_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v23 = PropGet v22 key="name"
// CHECK-NEXT: v24 = Call v23, v22 calleeKey="name" calleeName="name"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v26 = String string="a"
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="fromPattern"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v31 = CheckInitialized v30 name="fromArray"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v33 = Call v8, v6, v12, v14, v16, v18, v25, v26, v29, v32 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v34 = Builtin builtin=GlobalThis
// CHECK-NEXT: v35 = PropGet v34 key="console" [isFreeName]
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v37 = PropGet v36 key="log"
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v39 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v40 = CheckInitialized v39 name="viaStar"
// CHECK-NEXT: v41 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v42 = CheckInitialized v41 name="viaNamedBarrel"
// CHECK-NEXT: v43 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v44 = CheckInitialized v43 name="viaNamespaceExport"
// CHECK-NEXT: v45 = Call v38, v36, v40, v42, v44 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v46 = Builtin builtin=GlobalThis
// CHECK-NEXT: v47 = PropGet v46 key="console" [isFreeName]
// CHECK-NEXT: v48 = Convert v47 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v49 = PropGet v48 key="log"
// CHECK-NEXT: v50 = Convert v49 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v51 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v52 = CheckInitialized v51 name="viaNamespace"
// CHECK-NEXT: v53 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v54 = CheckInitialized v53 name="viaImportEquals"
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v58 = Boolean boolean=true
// CHECK-NEXT: v59 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v60 = CheckInitialized v59 name="viaRequire"
// CHECK-NEXT: v61 = ImportModule module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v62 = Await v61
// CHECK-NEXT: v63 = Convert v62 declared={type=undefined|null|object site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v64 = PropGet v63 key="viaImportCall"
// CHECK-NEXT: v65 = Call v50, v48, v52, v54, v60, v64 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v66 = Undefined
// CHECK-NEXT: Return v66
// CHECK-NEXT: }
