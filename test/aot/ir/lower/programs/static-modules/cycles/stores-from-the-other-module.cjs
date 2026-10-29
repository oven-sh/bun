// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: ModulesWithNames >= 2
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// While a runs, b stores to names of a: one that a has stored, one that a adds to afterwards, and one that a stores only later. a reads what b stored, and its own later store wins. All by names.
const a = require("./a.cjs");
console.log(a.afterB, require("./b.cjs").read());

// FILE: a.cjs
exports.count = 1;
exports.replaced = "by a";
const b = require("./b.cjs");
exports.count++;
exports.afterB = [exports.count, exports.replaced, exports.planted].join();
exports.planted = "by a";

// FILE: b.cjs
const a = require("./a.cjs");
a.count += 10;
a.replaced = "by b";
a.planted = "by b";
exports.read = () => [a.count, a.replaced, a.planted].join();

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
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_5]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v14 = Boolean boolean=true
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: v17 = Call v15, v16 calleeName="read"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = Call v10, v8, v12, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
