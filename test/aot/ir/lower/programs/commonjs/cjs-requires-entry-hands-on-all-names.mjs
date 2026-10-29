// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A commonjs file requires the entry point that hands on all its names.
export * from "./lib.cjs";
export const own = "main.own";
console.log("main runs");

// FILE: lib.cjs
console.log("lib begins");
exports.first = 1;
const main = require("./main.mjs");
console.log("lib: required", Object.keys(main).join(), main.first, main.second, main.own);
exports.second = 2;
console.log("lib ends");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="main.own"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|"main.own" flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_1]]
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="main runs"
// CHECK-NEXT: v9 = Call v7, v5, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
