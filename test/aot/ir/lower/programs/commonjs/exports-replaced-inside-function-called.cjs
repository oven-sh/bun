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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = Builtin builtin=JSON
// CHECK-NEXT: v12 = PropGet v11 key="stringify"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v14 = Call v13, v11, v5 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v5 key="f"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v18 = Call v17, v5 calleeKey="f" calleeName="t.f"
// CHECK-NEXT: v19 = Convert v18 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v20 = Call v10, v8, v15, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
