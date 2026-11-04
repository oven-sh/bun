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
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Config"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="Shape"
// CHECK-NEXT: v10 = Construct v9 calleeName="Shape"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v12 = PropGet v11 key="area"
// CHECK-NEXT: v13 = Call v12, v11 calleeKey="area" calleeName="area"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="Shape"
// CHECK-NEXT: v16 = PropGet v15 key="unit"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="parse"
// CHECK-NEXT: v19 = String string="x"
// CHECK-NEXT: v20 = Call v18, -, v19 calleeName="parse"
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v22 = CheckInitialized v21 name="parse"
// CHECK-NEXT: v23 = PropGet v22 key="version"
// CHECK-NEXT: v24 = Integer integer=1
// CHECK-NEXT: v25 = Integer integer=2
// CHECK-NEXT: v26 = Add v24, v25
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="Level"
// CHECK-NEXT: v29 = PropGet v28 key="describe"
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v31 = CheckInitialized v30 name="Level"
// CHECK-NEXT: v32 = PropGet v31 key="High"
// CHECK-NEXT: v33 = Call v29, v28, v32 calleeKey="describe" calleeName="Level.describe"
// CHECK-NEXT: v34 = PropGet v2 key="port"
// CHECK-NEXT: v35 = Call v7, v5, v13, v16, v20, v23, v26, v33, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v36 = Builtin builtin=GlobalThis
// CHECK-NEXT: v37 = PropGet v36 key="console" [isFreeName]
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v38 key="log"
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v41 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v42 = CheckInitialized v41 name="Default"
// CHECK-NEXT: v43 = Construct v42 calleeName="Default"
// CHECK-NEXT: v44 = Convert v43 declared={type=undefined|null|[[L_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v45 = PropGet v44 key="name"
// CHECK-NEXT: v46 = Call v45, v44 calleeKey="name" calleeName="name"
// CHECK-NEXT: v47 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v48 = CheckInitialized v47 name="Default"
// CHECK-NEXT: v49 = PropGet v48 key="label"
// CHECK-NEXT: v50 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v51 = CheckInitialized v50 name="Shape"
// CHECK-NEXT: v52 = PropGet v51 key="unit"
// CHECK-NEXT: v53 = Builtin builtin=Object
// CHECK-NEXT: v54 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v55 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v56 = CheckInitialized v55 name="Pieces"
// CHECK-NEXT: v57 = Call v54, v53, v56 calleeName="Object.keys"
// CHECK-NEXT: v58 = Convert v57 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v59 = PropGet v58 key="length"
// CHECK-NEXT: v60 = Call v40, v38, v46, v49, v52, v59 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v61 = Undefined
// CHECK-NEXT: Return v61
// CHECK-NEXT: }
