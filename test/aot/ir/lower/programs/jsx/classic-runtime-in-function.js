// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// Classic JSX runtime: an element with props and children created inside a function, with `React` imported from a CommonJS module.
/** @jsxRuntime classic */
import React from "./r.cjs";
const f = () => <a k="v">x</a>; console.log(f(), f());

// FILE: r.cjs
exports.createElement = (t, p, ...c) => [typeof t === "function" ? "component" : String(t), p ? Object.keys(p).join() : "-", c.length].join(":");
exports.Fragment = "fragment";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v0 calleeName="f"
// CHECK-NEXT: v7 = Call v0 calleeName="f"
// CHECK-NEXT: v8 = Call v5, v3, v6, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="React"
// CHECK-NEXT: v2 = PropGet v1 key="createElement"
// CHECK-NEXT: v3 = String string="a"
// CHECK-NEXT: v4 = String string="v"
// CHECK-NEXT: v5 = NewObject -, v4 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = String string="x"
// CHECK-NEXT: v8 = Call v2, v1, v3, v6, v7 calleeKey="createElement" calleeName="createElement"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
