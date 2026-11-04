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
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="port"
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: v3 = NewObject -, v2 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v4 = FinishObject v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="Mode"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|"fast" flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="debug"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="debug"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="port"
// CHECK-NEXT: v15 = Integer integer=80
// CHECK-NEXT: v16 = StrictEq v14, v15
// CHECK-NEXT: v17 = LogicalNot v16
// CHECK-NEXT: v18 = Boolean
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="twice"
// CHECK-NEXT: v21 = Integer integer=160
// CHECK-NEXT: v22 = StrictEq v20, v21
// CHECK-NEXT: v23 = LogicalNot v22
// CHECK-NEXT: v24 = Boolean
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="cast"
// CHECK-NEXT: v27 = Convert v26 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v28 = Integer integer=7
// CHECK-NEXT: v29 = StrictEq v27, v28
// CHECK-NEXT: v30 = LogicalNot v29
// CHECK-NEXT: v31 = Boolean
// CHECK-NEXT: v32 = Builtin builtin=GlobalThis
// CHECK-NEXT: v33 = PropGet v32 key="console" [isFreeName]
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v34 key="log"
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v38 = CheckInitialized v37 name="name"
// CHECK-NEXT: v39 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v40 = CheckInitialized v39 name="limit"
// CHECK-NEXT: v41 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v42 = CheckInitialized v41 name="twice"
// CHECK-NEXT: v43 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v44 = CheckInitialized v43 name="name"
// CHECK-NEXT: v45 = PropGet v44 key="length"
// CHECK-NEXT: v46 = Call v36, v34, v5, v8, v38, v40, v42, v45 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v47 = Undefined
// CHECK-NEXT: Return v47
// CHECK-NEXT: }
