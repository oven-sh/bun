// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// `import n = ns.n` is the only mention of what `import ns = require(..)` of an ES module answers.
import ns = require("./lib");
import n = ns.n;
console.log(n + 1);

// FILE: lib.ts
export const n = 10;
export function f(a: number) {
  return a + 1;
}
export class C {
  v = 7;
}
export const s = "s";

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
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: v6 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v7 = PropGet v6 key="n"
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = Convert v7 declared={type=10} illTypedCause=Assertion
// CHECK-NEXT: v14 = Integer integer=1
// CHECK-NEXT: v15 = Add v13, v14
// CHECK-NEXT: v16 = Call v12, v10, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
