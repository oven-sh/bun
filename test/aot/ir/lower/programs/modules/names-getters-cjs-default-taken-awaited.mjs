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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = ImportModule module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Promise<undefined|null|object> flags=[IsExpected]}
// CHECK-NEXT: v2 = Await v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v4 = TypeTest v3 testedType=undefined|null
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v6 = NewRuntimeError runtimeError=NotDestructurable name="number"
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: v8 = PropGet v7 key="number"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v7 key="greet"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v11 calleeName="greet"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = Call v16, v14, v9, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
