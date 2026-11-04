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
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="B"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Buffer) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="from"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(BufferFrom) flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="abc"
// CHECK-NEXT: v11 = Call v9, v7, v10 calleeKey="from" calleeName="B.from"
// CHECK-NEXT: v12 = PropGet v11 key="length"
// CHECK-NEXT: v13 = Call v4, v2, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
