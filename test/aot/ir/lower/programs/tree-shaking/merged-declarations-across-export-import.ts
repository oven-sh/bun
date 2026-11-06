// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// The merged names of merged.ts are exported and used from here: the class side of one, the namespace side of another, both pieces of an enum, a function with its namespace, a default export that is a merged class.
import Default, { Shape, parse, Pieces, Level, Config } from "./merged";
import * as merged from "./merged";

const config: Config = Config;
console.log(new Shape().area(), Shape.unit, parse("x"), parse.version, Pieces.One + Pieces.Two, Level.describe(Level.High), config.port);
console.log(new Default().name(), Default.label, merged.Shape.unit, Object.keys(merged.Pieces).length);

// FILE: merged.ts
export class Shape { area() { return 4; } }
export namespace Shape { export const unit = "cm"; }
export function parse(text: string) { return "parsed " + text; }
export namespace parse { export const version = 2; }
export enum Pieces { One = 1 }
export enum Pieces { Two = 2 }
export enum Level { High = "high" }
export namespace Level { export const describe = (level: Level) => "level " + level; }
export interface Config { port: number }
export const Config = { port: 81 };
class Default { name() { return "the default"; } }
namespace Default { export const label = "its label"; }
export default Default;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Config"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="Shape"
// CHECK-NEXT: v10 = Construct v9 calleeName="Shape"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v12 = PropGet v11 key="area"
// CHECK-NEXT: v13 = Call v12, v11 calleeKey="area" calleeName="area"
// CHECK-NEXT: v14 = Convert v13 declared={type=number site=[[w_5]]}
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="Shape"
// CHECK-NEXT: v17 = PropGet v16 key="unit"
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="parse"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[f_7]]} illTypedCause=Assertion
// CHECK-NEXT: v21 = String string="x"
// CHECK-NEXT: v22 = Call v20, -, v21 calleeName="parse"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v25 = CheckInitialized v24 name="parse"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[f_7]]} illTypedCause=Assertion
// CHECK-NEXT: v27 = PropGet v26 key="version"
// CHECK-NEXT: v28 = Convert v27 declared={type=2 site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="Pieces"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v32 = PropGet v31 key="One"
// CHECK-NEXT: v33 = Convert v32 declared={type=1 site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v34 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v35 = CheckInitialized v34 name="Pieces"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v37 = PropGet v36 key="Two"
// CHECK-NEXT: v38 = Convert v37 declared={type=2 site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: v39 = Add v33, v38
// CHECK-NEXT: v40 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v41 = CheckInitialized v40 name="Level"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v43 = PropGet v42 key="describe"
// CHECK-NEXT: v44 = Convert v43 declared={type=undefined|null|[[f_14]] site=[[w_15]]} illTypedCause=Assertion
// CHECK-NEXT: v45 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v46 = CheckInitialized v45 name="Level"
// CHECK-NEXT: v47 = Convert v46 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v48 = PropGet v47 key="High"
// CHECK-NEXT: v49 = Call v44, v42, v48 calleeKey="describe" calleeName="Level.describe"
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v51 = PropGet v2 key="port"
// CHECK-NEXT: v52 = Call v7, v5, v14, v17, v23, v28, v39, v50, v51 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v53 = Builtin builtin=GlobalThis
// CHECK-NEXT: v54 = PropGet v53 key="console" [isFreeName]
// CHECK-NEXT: v55 = Convert v54 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v56 = PropGet v55 key="log"
// CHECK-NEXT: v57 = Convert v56 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v58 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v59 = CheckInitialized v58 name="Default"
// CHECK-NEXT: v60 = Convert v59 declared={type=undefined|null|[[f_18]]} illTypedCause=Assertion
// CHECK-NEXT: v61 = Construct v60 calleeName="Default"
// CHECK-NEXT: v62 = Convert v61 declared={type=undefined|null|[[L_19]] site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v63 = PropGet v62 key="name"
// CHECK-NEXT: v64 = Call v63, v62 calleeKey="name" calleeName="name"
// CHECK-NEXT: v65 = Convert v64 declared={type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v66 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v67 = CheckInitialized v66 name="Default"
// CHECK-NEXT: v68 = Convert v67 declared={type=undefined|null|[[f_18]]} illTypedCause=Assertion
// CHECK-NEXT: v69 = PropGet v68 key="label"
// CHECK-NEXT: v70 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v71 = CheckInitialized v70 name="Shape"
// CHECK-NEXT: v72 = Convert v71 declared={type=undefined|null|[[f_21]] site=[[w_22]]} illTypedCause=Assertion
// CHECK-NEXT: v73 = PropGet v72 key="unit"
// CHECK-NEXT: v74 = Builtin builtin=Object
// CHECK-NEXT: v75 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v76 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v77 = CheckInitialized v76 name="Pieces"
// CHECK-NEXT: v78 = Convert v77 declared={type=undefined|null|object site=[[w_23]]} illTypedCause=Assertion
// CHECK-NEXT: v79 = Call v75, v74, v78 calleeName="Object.keys"
// CHECK-NEXT: v80 = Convert v79 declared={type=undefined|null|Array<undefined|null|string> site=[[w_24]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v81 = PropGet v80 key="length"
// CHECK-NEXT: v82 = Call v57, v55, v65, v69, v73, v81 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v83 = Undefined
// CHECK-NEXT: Return v83
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
