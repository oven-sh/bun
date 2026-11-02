// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A package in the output of bun build asks whether require is there.
import kindOfModule, { kindOfRequire } from "built-by-bun";
console.log(kindOfModule, kindOfRequire);

// FILE: node_modules/built-by-bun/index.js
// @bun
export const kindOfRequire = typeof require === "function" ? "has require" : "has no require";
export default typeof module;

// FILE: node_modules/built-by-bun/package.json
{ "name": "built-by-bun", "main": "index.js" }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="kindOfModule"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="kindOfRequire"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|"has no require"|"has require" flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v4, v2, v7, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
