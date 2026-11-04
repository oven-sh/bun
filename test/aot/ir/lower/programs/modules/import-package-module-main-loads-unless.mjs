// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 6

// FILE: main.mjs
// The package.json of each package names a CommonJS file as "main" and an ES module as "module". One package is only imported: by a statement, through
// `export { } from` and by `import()`. One is only required. One is imported and required.
import { which as imported } from "only-imported";
import { which as handedOn } from "./barrel.mjs";
import { which as both } from "imported-and-required";
import { onlyRequired, required } from "./requires.cjs";

console.log(imported, handedOn, (await import("only-imported")).which);
console.log(onlyRequired);
console.log(both, required, (await import("imported-and-required")).which);

// FILE: barrel.mjs
export { which } from "only-imported";

// FILE: node_modules/imported-and-required/index.cjs
exports.which = "main";

// FILE: node_modules/imported-and-required/index.mjs
export const which = "module";

// FILE: node_modules/imported-and-required/package.json
{ "name": "imported-and-required", "version": "1.0.0", "main": "./index.cjs", "module": "./index.mjs" }

// FILE: node_modules/only-imported/index.cjs
exports.which = "main";

// FILE: node_modules/only-imported/index.mjs
export const which = "module";

// FILE: node_modules/only-imported/package.json
{ "name": "only-imported", "version": "1.0.0", "main": "./index.cjs", "module": "./index.mjs" }

// FILE: node_modules/only-required/index.cjs
exports.which = "main";

// FILE: node_modules/only-required/index.mjs
export const which = "module";

// FILE: node_modules/only-required/package.json
{ "name": "only-required", "version": "1.0.0", "main": "./index.cjs", "module": "./index.mjs" }

// FILE: requires.cjs
exports.onlyRequired = require("only-required").which;
exports.required = require("imported-and-required").which;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="imported"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="handedOn"
// CHECK-NEXT: v9 = ImportModule module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v10 = Await v9
// CHECK-NEXT: v11 = PropGet v10 key="which"
// CHECK-NEXT: v12 = Call v4, v2, v6, v8, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v19 = Call v17, v15, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="both"
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v28 = ImportModule module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: v29 = Await v28
// CHECK-NEXT: v30 = PropGet v29 key="which"
// CHECK-NEXT: v31 = Call v24, v22, v26, v27, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
