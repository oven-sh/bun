// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 3

// FILE: main.ts
// The package names one file for `import` and another for `require`. Where a program does both, both get the file for `require`, also in a file under a tsconfig.json with other compiler options, from which no `require` of the package is reached.
import { kindByName, kindByNamespace, kindOfOther } from "./strict/importer.ts";

const required: { kind: string } = require("two-files");
console.log(required.kind, kindByName(), kindByNamespace(), kindOfOther());

// FILE: node_modules/only-imported/imported.js
export const kind = "the file for import";

// FILE: node_modules/only-imported/index.d.ts
export declare const kind: string;

// FILE: node_modules/only-imported/package.json
{ "name": "only-imported", "main": "./required.js", "module": "./imported.js", "types": "./index.d.ts" }

// FILE: node_modules/only-imported/required.js
exports.kind = "the file for require";

// FILE: node_modules/two-files/imported.js
export const kind = "the file for import";

// FILE: node_modules/two-files/index.d.ts
export declare const kind: string;

// FILE: node_modules/two-files/package.json
{ "name": "two-files", "main": "./required.js", "module": "./imported.js", "types": "./index.d.ts" }

// FILE: node_modules/two-files/required.js
exports.kind = "the file for require";

// FILE: strict/importer.ts
import * as other from "only-imported";
import * as both from "two-files";
import { kind } from "two-files";

export const kindByName = (): string => kind;
export const kindByNamespace = (): string => both.kind;
export const kindOfOther = (): string => other.kind;

// FILE: strict/tsconfig.json
{ "compilerOptions": { "strict": true } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v1 = Boolean boolean=true
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="kindByName"
// CHECK-NEXT: v10 = Call v9 calleeName="kindByName"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="kindByNamespace"
// CHECK-NEXT: v14 = Call v13 calleeName="kindByNamespace"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="kindOfOther"
// CHECK-NEXT: v18 = Call v17 calleeName="kindOfOther"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v20 = Call v6, v4, v7, v11, v15, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
