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
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = ModuleBuiltin builtin=ModuleObject module=[[m_3]]
// CHECK-NEXT: v5 = PropGet v4 key="exports"
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v6 key="n"
// CHECK-NEXT: v13 = PropGet v6 key="more"
// CHECK-NEXT: v14 = PropGet v6 key="keys"
// CHECK-NEXT: v15 = Call v11, v9, v12, v13, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
