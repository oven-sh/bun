// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 2

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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v1 = Boolean boolean=true
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="kindByName"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11 calleeName="kindByName"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="kindByNamespace"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v16 calleeName="kindByNamespace"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="kindOfOther"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v22 = Call v21 calleeName="kindOfOther"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v24 = Call v7, v5, v8, v13, v18, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
