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
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v3 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v3 key="h"
// CHECK-NEXT: v10 = String string="div"
// CHECK-NEXT: v11 = String string="1"
// CHECK-NEXT: v12 = NewObject -, v11 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v13 = FinishObject v12
// CHECK-NEXT: v14 = String string="x"
// CHECK-NEXT: v15 = Call v9, v3, v10, v13, v14 calleeKey="h" calleeName="h"
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="s"
// CHECK-NEXT: v18 = Call v8, v6, v15, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
