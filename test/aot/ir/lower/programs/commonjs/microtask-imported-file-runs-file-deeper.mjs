// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.mjs
// A microtask of an imported file runs before a file of a deeper module.
import { first } from "./first.cjs";
import { deeper } from "./module.mjs";
console.log(first, deeper, globalThis.seen);

// FILE: deeper.cjs
exports.deeper = globalThis.seen;

// FILE: first.cjs
globalThis.seen = "early";
exports.first = 1;
queueMicrotask(() => {
  globalThis.seen = "late";
});

// FILE: module.mjs
export { deeper } from "./deeper.cjs";

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
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="globalThis" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="seen"
// CHECK-NEXT: v11 = Call v4, v2, v5, v6, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
