// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// `import C = ns.C` is named by a type alone, and `import n = ns.n` by nothing.
import ns = require("./lib");
import C = ns.C;
import n = ns.n;
let c: C | undefined;
console.log(typeof c, ns.s);

// FILE: lib.ts
export const n = 10;
export function f(a: number) {
  return a + 1;
}
export class C {
  v = 7;
}
export const s = "s";
console.log("lib runs");

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
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="console" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="log"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v14 = TypeOf v8
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="s"
// CHECK-NEXT: v17 = Call v13, v11, v14, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
