// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A CommonJS file has `__esModule`, a `default` of its own and getters that return bindings of its top level. A module takes the names out of
// what `import()` gives by a pattern.
const { number, greet } = await import("./file.cjs");
console.log(number, greet());

// FILE: file.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "number", { enumerable: true, get: function () { return number; } });
Object.defineProperty(exports, "greet", { enumerable: true, get: function () { return greet; } });
const number = 1;
function greet() {
  return "hello " + number;
}
exports.default = "own default";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = ImportModule module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v1 = Await v0
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined|null
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = NewRuntimeError runtimeError=NotDestructurable name="number"
// CHECK-NEXT: Throw v4
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = PropGet v5 key="number"
// CHECK-NEXT: v7 = PropGet v5 key="greet"
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v7 calleeName="greet"
// CHECK-NEXT: v14 = Call v12, v10, v6, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
