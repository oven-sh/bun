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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="read"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="defaults"
// CHECK-NEXT: v11 = Call v10 calleeName="defaults"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_2]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Call v8, -, v12 calleeName="read"
// CHECK-NEXT: v14 = Convert v13 declared={type=number site=[[w_7]]}
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="read"
// CHECK-NEXT: v17 = Data data=[[d_8]]
// CHECK-NEXT: v18 = Call v16, -, v17 calleeName="read"
// CHECK-NEXT: v19 = Convert v18 declared={type=number site=[[w_9]]}
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="read"
// CHECK-NEXT: v22 = Call v21, -, v1 calleeName="read"
// CHECK-NEXT: v23 = Convert v22 declared={type=number site=[[w_10]]}
// CHECK-NEXT: v24 = Call v6, v4, v14, v19, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="reset"
// CHECK-NEXT: v27 = Call v26, -, v1 calleeName="reset"
// CHECK-NEXT: v28 = Builtin builtin=GlobalThis
// CHECK-NEXT: v29 = PropGet v28 key="console" [isFreeName]
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v30 key="log"
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v33 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v34 = CheckInitialized v33 name="read"
// CHECK-NEXT: v35 = Call v34, -, v1 calleeName="read"
// CHECK-NEXT: v36 = Convert v35 declared={type=number site=[[w_12]]}
// CHECK-NEXT: v37 = Builtin builtin=Object
// CHECK-NEXT: v38 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v39 = Call v38, v37, v1 calleeName="Object.keys"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|Array<undefined|null|string> site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v41 = Builtin builtin=Object
// CHECK-NEXT: v42 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v43 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v44 = CheckInitialized v43 name="defaults"
// CHECK-NEXT: v45 = Call v44 calleeName="defaults"
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|null|[[L_2]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v47 = Call v42, v41, v46 calleeName="Object.keys"
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|Array<undefined|null|string> site=[[w_15]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v49 = Call v32, v30, v36, v40, v48 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v50 = Data data=[[d_16]]
// CHECK-NEXT: v51 = Convert v50 declared={type=undefined|null|[[L_17]] site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v52 = Builtin builtin=GlobalThis
// CHECK-NEXT: v53 = PropGet v52 key="console" [isFreeName]
// CHECK-NEXT: v54 = Convert v53 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v55 = PropGet v54 key="log"
// CHECK-NEXT: v56 = Convert v55 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v57 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v58 = CheckInitialized v57 name="handle"
// CHECK-NEXT: v59 = Call v58, -, v51 calleeName="handle"
// CHECK-NEXT: v60 = Convert v59 declared={type=number site=[[w_20]]}
// CHECK-NEXT: v61 = GetModuleVariable variable=[[g_21]]
// CHECK-NEXT: v62 = CheckInitialized v61 name="visit"
// CHECK-NEXT: v63 = Call v62, -, v51 calleeName="visit"
// CHECK-NEXT: v64 = Convert v63 declared={type=number site=[[w_22]]}
// CHECK-NEXT: v65 = Call v56, v54, v60, v64 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v66 = Undefined
// CHECK-NEXT: Return v66
// CHECK-NEXT: }
