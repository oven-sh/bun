// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Convert v0 declared={type=boolean site=[[w_1]]}
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="load"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v10 calleeName="load"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Await v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="loadOther"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v18 = Call v17 calleeName="loadOther"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v20 = Await v19
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v22 = Call v7, v5, v1, v14, v21 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
