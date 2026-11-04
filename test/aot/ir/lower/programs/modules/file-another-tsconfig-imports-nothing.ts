// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// strict/ has a tsconfig.json whose compiler options are not the program's. A constant of the entry point, true because the program starts with it, decides there that an `import()` never runs, so the executable does not hold the file that it names.
import { load, loadOther } from "./strict/loader.ts";

export const IS_MAIN = import.meta.main;

console.log(IS_MAIN, await load(), await loadOther());

// FILE: strict/loaded.ts
export const text: string = "loaded where the entry point starts the program";

// FILE: strict/loader.ts
import { IS_MAIN } from "../main.ts";

export const load = async (): Promise<string> => (IS_MAIN ? "nothing is loaded" : (await import("./never-loaded.ts")).text);
export const loadOther = async (): Promise<string> => (IS_MAIN ? (await import("./loaded.ts")).text : "nothing is loaded");

// FILE: strict/never-loaded.ts
export const text: string = "loaded where another file starts the program";

// FILE: strict/tsconfig.json
{ "compilerOptions": { "strict": true } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: PutModuleVariable v0 variable=[[g_1]]
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="load"
// CHECK-NEXT: v9 = Call v8 calleeName="load"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = Await v10
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="loadOther"
// CHECK-NEXT: v14 = Call v13 calleeName="loadOther"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v16 = Await v15
// CHECK-NEXT: v17 = Call v6, v4, v0, v11, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
