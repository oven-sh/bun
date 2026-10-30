// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 2
// STATISTIC: SourceFilesData = 1

// FILE: main.ts
// A package without side effects exports and stores to its own package json.
import { pkg, version, port, spoil } from "quiet";
console.log(pkg.version, version, port(), pkg.nested.port);
spoil();
console.log(pkg.version, version, port(), pkg.nested.port);

// FILE: node_modules/quiet/index.js
export { default as pkg, version } from "./package.json";
export * from "./other.js";

// FILE: node_modules/quiet/other.js
import pkg from "./package.json";
export const port = () => pkg.nested.port;
export const spoil = () => { pkg.nested.port = 81; pkg.version = "9"; };

// FILE: node_modules/quiet/package.json
{ "name": "quiet", "version": "4.5.6", "main": "index.js", "sideEffects": false, "nested": { "port": 80 } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="pkg"
// CHECK-NEXT: v7 = PropGet v6 key="version"
// CHECK-NEXT: v8 = String string="4.5.6"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="port"
// CHECK-NEXT: v11 = Call v10 calleeName="port"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="pkg"
// CHECK-NEXT: v14 = PropGet v13 key="nested"
// CHECK-NEXT: v15 = PropGet v14 key="port"
// CHECK-NEXT: v16 = Call v4, v2, v7, v8, v11, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="spoil"
// CHECK-NEXT: v19 = Call v18 calleeName="spoil"
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="pkg"
// CHECK-NEXT: v27 = PropGet v26 key="version"
// CHECK-NEXT: v28 = String string="4.5.6"
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="port"
// CHECK-NEXT: v31 = Call v30 calleeName="port"
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v33 = CheckInitialized v32 name="pkg"
// CHECK-NEXT: v34 = PropGet v33 key="nested"
// CHECK-NEXT: v35 = PropGet v34 key="port"
// CHECK-NEXT: v36 = Call v24, v22, v27, v28, v31, v35 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v37 = Undefined
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
