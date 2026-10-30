// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesDemoted = 1

// FILE: main.cts
// lib.cts says `import n = exports.n` and `import all = module.exports`, which the type checker is told not to look at.
const lib = require("./lib.cts");
console.log(lib.n, lib.more, lib.keys);

// FILE: lib.cts
// @ts-nocheck
exports.n = 10;
import n = exports.n;
import all = module.exports;
exports.more = n + 1;
exports.keys = Object.keys(all).join();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = ModuleBuiltin builtin=ModuleObject module=[[m_3]]
// CHECK-NEXT: v5 = PropGet v4 key="exports"
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v7 key="n"
// CHECK-NEXT: v14 = PropGet v7 key="more"
// CHECK-NEXT: v15 = PropGet v7 key="keys"
// CHECK-NEXT: v16 = Call v12, v10, v13, v14, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
