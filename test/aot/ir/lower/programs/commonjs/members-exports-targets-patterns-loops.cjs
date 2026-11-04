// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// Members of exports as targets of patterns and loops.
const m = require("./m.cjs");
console.log(Object.keys(m).join(), m.a, m.b, m.c, m.d);

// FILE: m.cjs
[exports.a, exports.b = 7] = [1];
({ q: exports.c, ...exports.d } = { q: 3, r: 4 });
for (exports.e of [1, 2]);
for (exports.f in { k: 1 });

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
// CHECK-NEXT: v11 = Builtin builtin=Object
// CHECK-NEXT: v12 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v13 = Call v12, v11, v5 calleeName="Object.keys"
// CHECK-NEXT: v14 = PropGet v13 key="join"
// CHECK-NEXT: v15 = Call v14, v13 calleeKey="join" calleeName="join"
// CHECK-NEXT: v16 = PropGet v5 key="a"
// CHECK-NEXT: v17 = PropGet v5 key="b"
// CHECK-NEXT: v18 = PropGet v5 key="c"
// CHECK-NEXT: v19 = PropGet v5 key="d"
// CHECK-NEXT: v20 = Call v10, v8, v15, v16, v17, v18, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
