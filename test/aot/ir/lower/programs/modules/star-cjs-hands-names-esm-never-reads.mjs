// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.mjs
// A CommonJS file as tsc emits it, with a default of its own, hands on names of an ES module behind getters. Imports through `export *` take some of them, and nothing reads the others.
import { first, bump } from "./barrel.mjs";
import { first as again } from "./outer-barrel.mjs";
bump();
console.log(first, again);

// FILE: barrel.mjs
export * from "./emitted.cjs";

// FILE: classes.mjs
console.log("classes.mjs runs");
export class Unread {}
export let count = 0;
export function bump() {
  count++;
  console.log("bumped to", count);
}

// FILE: emitted.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bump = exports.count = exports.Unread = exports.first = void 0;
exports.first = 1;
exports.default = 2;
var classes_1 = require("./classes.mjs");
Object.defineProperty(exports, "Unread", { enumerable: true, get: function () { return classes_1.Unread; } });
Object.defineProperty(exports, "count", { enumerable: true, get: function () { return classes_1.count; } });
Object.defineProperty(exports, "bump", { enumerable: true, get: function () { return classes_1.bump; } });

// FILE: outer-barrel.mjs
export * from "./barrel.mjs";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="bump"
// CHECK-NEXT: v2 = Call v1 calleeName="bump"
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = Convert v8 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v11 = Convert v10 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v7, v5, v9, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
