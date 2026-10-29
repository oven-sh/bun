// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// view.js says `@jsx exports.h`, and stores to `exports.h` and `exports.v`.
console.log(require("./view.js").v);

// FILE: view.js
/** @jsxRuntime classic */
/** @jsx exports.h */
exports.h = function (tag) {
  return "h:" + tag + ":" + Object.keys(this).join();
};
exports.v = <div />;

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
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = Convert v9 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="v"
// CHECK-NEXT: v13 = Call v7, v5, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
