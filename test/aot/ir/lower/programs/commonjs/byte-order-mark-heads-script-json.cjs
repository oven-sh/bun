// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2
// STATISTIC: SourceFilesData = 1

// FILE: main.cjs
﻿console.log("behind a byte order mark", require("./d.json").k, require("./m.cjs").v);

// FILE: d.json
﻿{"k":1}

// FILE: m.cjs
﻿#!/usr/bin/env bun
exports.v = "crlf";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="behind a byte order mark"
// CHECK-NEXT: v9 = RequireModule module=[[m_3]] referrer=[[m_0]] specifier="./d.json"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="k"
// CHECK-NEXT: v12 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v14 = Boolean boolean=true
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|"crlf" flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v7, v5, v8, v12, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
