// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A getter that throws gives undefined to an ES importer.
import { bad, ok } from "./a.cjs";
console.log(bad, ok);

// FILE: a.cjs
Object.defineProperty(exports, "bad", {
  enumerable: true,
  get() {
    throw new Error("no");
  },
});
exports.ok = 1;

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="bad"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="ok"
// CHECK-NEXT: v9 = Call v4, v2, v6, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsHiddenInStackTraces] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = TypeTest v0 testedType=absent
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = ThrowModuleFailure failure=q0
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v6 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: v8 = ThrowModuleFailure failure=q1
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
