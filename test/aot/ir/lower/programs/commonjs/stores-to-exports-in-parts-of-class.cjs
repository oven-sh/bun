// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// Stores to exports in the parts of a class.
const m = require("./m.cjs");
console.log(Object.keys(m).join());

// FILE: m.cjs
class A extends (exports.a = 1, Object) {
  static s = (exports.b = 2);
  [(exports.c = 3)]() {}
  i = (exports.d = 4);
  static { exports.e = 5; }
}
exports.z = 0;

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
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = Builtin builtin=Object
// CHECK-NEXT: v13 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v14 = Call v13, v12, v6 calleeName="Object.keys"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="join"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v18 = Call v17, v15 calleeKey="join" calleeName="join"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v20 = Call v11, v9, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
