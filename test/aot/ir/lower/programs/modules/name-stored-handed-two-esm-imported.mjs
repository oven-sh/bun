// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.mjs
// A CommonJS file stores a name behind `&&`, two ES modules hand it on, a second CommonJS file has a getter over them, and this module imports the name from that file.
import { one } from "./over.cjs";
console.log(one);

// FILE: between.mjs
export * from "./further.mjs";

// FILE: further.mjs
export { one } from "./lib.cjs";

// FILE: lib.cjs
process.argv.length <= 99 && (exports.one = 1);

// FILE: over.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var below_1 = require("./between.mjs");
Object.defineProperty(exports, "one", {
  enumerable: true,
  get: function () {
    return below_1.one;
  },
});

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="one"
// CHECK-NEXT: v7 = Convert v6 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v4, v2, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
