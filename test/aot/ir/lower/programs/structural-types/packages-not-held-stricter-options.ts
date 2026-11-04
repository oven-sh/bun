// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// Two packages ship TypeScript that exactOptionalPropertyTypes and strictFunctionTypes would reject. Only the application has these options on, so the packages keep their types.
import { defaults, read, reset } from "exact";
import { handle, visit } from "variance";

const options = { limit: 3, step: 4 };
console.log(read(defaults()), read({ step: 2 }), read(options));
reset(options);
console.log(read(options), Object.keys(options), Object.keys(defaults()));
const rex = { name: "rex", bark: 2 };
console.log(handle(rex), visit(rex));

// FILE: node_modules/exact/index.ts
export interface Options {
  limit?: number;
  step: number;
}
export function defaults(): Options {
  return { limit: undefined, step: 1 };
}
export function reset(options: Options): void {
  options.limit = undefined;
}
export function read(options: Options): number {
  return (options.limit ?? 10) + options.step;
}

// FILE: node_modules/exact/package.json
{ "name": "exact", "version": "1.0.0", "main": "index.ts", "types": "index.ts" }

// FILE: node_modules/variance/index.ts
export interface Animal {
  name: string;
}
export interface Dog extends Animal {
  bark: number;
}
export type Handler = (animal: Animal) => number;
export const handler: Handler = (dog: Dog) => dog.bark;
export function handle(animal: Animal): number {
  return handler(animal);
}
function each<T>(item: T, callback: (item: T) => number): number {
  return callback(item);
}
export function visit(animal: Animal): number {
  return each(animal, (dog: Dog) => dog.bark + 1);
}

// FILE: node_modules/variance/package.json
{ "name": "variance", "version": "1.0.0", "main": "index.ts", "types": "index.ts" }

// FILE: package.json
{ "name": "application" }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "exactOptionalPropertyTypes": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="read"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="defaults"
// CHECK-NEXT: v10 = Call v9 calleeName="defaults"
// CHECK-NEXT: v11 = Call v7, -, v10 calleeName="read"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="read"
// CHECK-NEXT: v14 = Data data=[[d_4]]
// CHECK-NEXT: v15 = Call v13, -, v14 calleeName="read"
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="read"
// CHECK-NEXT: v18 = Call v17, -, v0 calleeName="read"
// CHECK-NEXT: v19 = Call v5, v3, v11, v15, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="reset"
// CHECK-NEXT: v22 = Call v21, -, v0 calleeName="reset"
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="console" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="log"
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v29 = CheckInitialized v28 name="read"
// CHECK-NEXT: v30 = Call v29, -, v0 calleeName="read"
// CHECK-NEXT: v31 = Builtin builtin=Object
// CHECK-NEXT: v32 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v33 = Call v32, v31, v0 calleeName="Object.keys"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v35 = Builtin builtin=Object
// CHECK-NEXT: v36 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v38 = CheckInitialized v37 name="defaults"
// CHECK-NEXT: v39 = Call v38 calleeName="defaults"
// CHECK-NEXT: v40 = Call v36, v35, v39 calleeName="Object.keys"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v42 = Call v27, v25, v30, v34, v41 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v43 = Data data=[[d_6]]
// CHECK-NEXT: v44 = Builtin builtin=GlobalThis
// CHECK-NEXT: v45 = PropGet v44 key="console" [isFreeName]
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v47 = PropGet v46 key="log"
// CHECK-NEXT: v48 = Convert v47 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v49 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v50 = CheckInitialized v49 name="handle"
// CHECK-NEXT: v51 = Call v50, -, v43 calleeName="handle"
// CHECK-NEXT: v52 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v53 = CheckInitialized v52 name="visit"
// CHECK-NEXT: v54 = Call v53, -, v43 calleeName="visit"
// CHECK-NEXT: v55 = Call v48, v46, v51, v54 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v56 = Undefined
// CHECK-NEXT: Return v56
// CHECK-NEXT: }
