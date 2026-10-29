// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// The same in TypeScript: annotated, asserted and merged with a type of the same name.
import limit, { debug, Mode, port, name, cast, type Shape } from "./flags";
import * as flags from "./flags";
import { twice } from "./computed";
const shape: Shape = { port };
const mode: Mode = Mode;
if (debug) await import("./never");
if (flags.debug) await import("./never");
if (port !== 80) await import("./never");
if (twice !== 160) await import("./never");
if ((cast as unknown as number) !== 7) await import("./never");
console.log(shape, mode, name, limit, twice, flags.name.length);

// FILE: computed.ts
import { port } from "./flags";
export const twice = port * 2;

// FILE: flags.ts
export interface Shape {
  port: number;
}
export const debug: boolean = false;
export const Mode = "fast";
export type Mode = typeof Mode;
export const port = 80 as const;
export const name = "server" satisfies string;
export const cast = 7 as unknown as string;
const limit: number = 10;
export default limit;

// FILE: never.ts
console.log("never runs");
export {};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="port"
// CHECK-NEXT: v2 = Convert v1 declared={type=80} illTypedCause=Assertion
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: v4 = NewObject -, v3 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="Mode"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|"fast" flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="debug"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="debug"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="port"
// CHECK-NEXT: v16 = Convert v15 declared={type=80} illTypedCause=Assertion
// CHECK-NEXT: v17 = Integer integer=80
// CHECK-NEXT: v18 = StrictEq v16, v17
// CHECK-NEXT: v19 = LogicalNot v18
// CHECK-NEXT: v20 = Boolean
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v22 = CheckInitialized v21 name="twice"
// CHECK-NEXT: v23 = Convert v22 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v24 = Integer integer=160
// CHECK-NEXT: v25 = StrictEq v23, v24
// CHECK-NEXT: v26 = LogicalNot v25
// CHECK-NEXT: v27 = Boolean
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v29 = CheckInitialized v28 name="cast"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v31 = Convert v30 declared={type=number site=[[w_8]]} illTypedCause=FromLooseType
// CHECK-NEXT: v32 = Integer integer=7
// CHECK-NEXT: v33 = StrictEq v31, v32
// CHECK-NEXT: v34 = LogicalNot v33
// CHECK-NEXT: v35 = Boolean
// CHECK-NEXT: v36 = Builtin builtin=GlobalThis
// CHECK-NEXT: v37 = PropGet v36 key="console" [isFreeName]
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v38 key="log"
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v41 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v42 = CheckInitialized v41 name="name"
// CHECK-NEXT: v43 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v44 = CheckInitialized v43 name="limit"
// CHECK-NEXT: v45 = Convert v44 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v46 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v47 = CheckInitialized v46 name="twice"
// CHECK-NEXT: v48 = Convert v47 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v49 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v50 = CheckInitialized v49 name="name"
// CHECK-NEXT: v51 = PropGet v50 key="length"
// CHECK-NEXT: v52 = Convert v51 declared={type=number site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v53 = Call v40, v38, v6, v9, v42, v45, v48, v52 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v54 = Undefined
// CHECK-NEXT: Return v54
// CHECK-NEXT: }
