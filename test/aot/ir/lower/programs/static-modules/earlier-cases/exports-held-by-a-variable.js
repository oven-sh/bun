// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// `var e = exports` and stores through it.
const lib = require("./lib");
console.log(lib.a, lib.b, lib.c(), lib.d());

// FILE: lib.js
"use strict";
var utils = exports;
const same = module.exports;
utils.a = "a";
same.b = "b";
exports.c = function () { return utils.a + same.b; };
utils.d = function () { return utils.c(); };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v5 key="a"
// CHECK-NEXT: v12 = PropGet v5 key="b"
// CHECK-NEXT: v13 = PropGet v5 key="c"
// CHECK-NEXT: v14 = Call v13, v5 calleeKey="c" calleeName="lib.c"
// CHECK-NEXT: v15 = PropGet v5 key="d"
// CHECK-NEXT: v16 = Call v15, v5 calleeKey="d" calleeName="lib.d"
// CHECK-NEXT: v17 = Call v10, v8, v11, v12, v14, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
