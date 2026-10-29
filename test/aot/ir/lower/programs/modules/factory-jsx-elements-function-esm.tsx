// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.tsx
// `@jsx ns.h` stands beside `ns.s`, where `const ns = require(..)` holds an ES module.
/** @jsxRuntime classic */
/** @jsx ns.h */
export {};
const ns = require("./lib");
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
console.log(<div a="1">x</div>, ns.s);

// FILE: lib.ts
export function h(tag: any, props: any, ...children: any[]) {
  return [typeof tag === "string" ? tag : typeof tag, props && Object.keys(props).join(), children.flat().join("|")].join(":");
}
export const Fragment = "fragment";
export const s = "s";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v3 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="console" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="log"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v4 key="h"
// CHECK-NEXT: v11 = String string="div"
// CHECK-NEXT: v12 = String string="1"
// CHECK-NEXT: v13 = NewObject -, v12 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v14 = FinishObject v13
// CHECK-NEXT: v15 = String string="x"
// CHECK-NEXT: v16 = Call v10, v4, v11, v14, v15 calleeKey="h" calleeName="h"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="s"
// CHECK-NEXT: v19 = Call v9, v7, v16, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
