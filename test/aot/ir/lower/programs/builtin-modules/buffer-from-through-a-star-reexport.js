// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// Buffer.from is written in JavaScript. This program names it only through a module of its own that exports everything of node:buffer again.
import { Buffer as B } from "./again.js";
console.log(B.from("abc").length);

// FILE: again.js
export * from "node:buffer";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="B"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Buffer) flags=[IsExpected]}
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="from"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(BufferFrom) flags=[IsExpected]}
// CHECK-NEXT: v11 = String string="abc"
// CHECK-NEXT: v12 = Call v10, v8, v11 calleeKey="from" calleeName="B.from"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Buffer flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="length"
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v4, v2, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
