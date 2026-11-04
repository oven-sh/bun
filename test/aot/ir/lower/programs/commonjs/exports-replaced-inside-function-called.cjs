// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// Exports replaced inside a function called where it is written.
const t = require("./t.cjs");
console.log(JSON.stringify(t), t.f());

// FILE: t.cjs
(function (root, factory) { module.exports = factory(); })(this, function () { return { a: 1, f() { return this.a; } }; });

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
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="console" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="log"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v10 = Builtin builtin=JSON
// CHECK-NEXT: v11 = PropGet v10 key="stringify"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12, v10, v4 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v14 = PropGet v4 key="f"
// CHECK-NEXT: v15 = Call v14, v4 calleeKey="f" calleeName="t.f"
// CHECK-NEXT: v16 = Call v9, v7, v13, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
