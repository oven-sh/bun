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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1 calleeName="f"
// CHECK-NEXT: v8 = Call v1 calleeName="f"
// CHECK-NEXT: v9 = Call v6, v4, v7, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = PropGet v0 key="createElement"
// CHECK-NEXT: v2 = String string="a"
// CHECK-NEXT: v3 = String string="v"
// CHECK-NEXT: v4 = NewObject -, v3 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: v6 = String string="x"
// CHECK-NEXT: v7 = Call v1, v0, v2, v5, v6 calleeKey="createElement" calleeName="createElement"
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
