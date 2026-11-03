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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="imported"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|"module" flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="handedOn"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|"module" flags=[IsExpected]}
// CHECK-NEXT: v11 = ImportModule module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Promise<undefined|null|object> flags=[IsExpected]}
// CHECK-NEXT: v13 = Await v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="which"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|"module" flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v4, v2, v7, v10, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|"main" flags=[IsExpected]}
// CHECK-NEXT: v25 = Call v22, v20, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="console" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="log"
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v32 = CheckInitialized v31 name="both"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|"main" flags=[IsExpected]}
// CHECK-NEXT: v34 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|"main" flags=[IsExpected]}
// CHECK-NEXT: v36 = ImportModule module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|Promise<undefined|null|[[L_7]]> flags=[IsExpected]}
// CHECK-NEXT: v38 = Await v37
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v40 = PropGet v39 key="which"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|"main" flags=[IsExpected]}
// CHECK-NEXT: v42 = Call v30, v28, v33, v35, v41 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v43 = Undefined
// CHECK-NEXT: Return v43
// CHECK-NEXT: }
