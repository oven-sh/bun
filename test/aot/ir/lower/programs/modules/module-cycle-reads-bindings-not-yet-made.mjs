// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.mjs
// A module on a cycle reads bindings that are not yet made.
import { a, fa } from "./a.mjs";
console.log(a, fa());

// FILE: a.mjs
import { b } from "./b.mjs";
export const a = "a" + b;
export function fa() { return "fa" + a; }
export default class D {}

// FILE: b.mjs
import D, { a, fa } from "./a.mjs";
let r = [];
for (const f of [() => a, () => fa(), () => D, () => typeof fa]) { try { r.push(String(f())); } catch (e) { r.push(e.name); } }
export const b = r.join();

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="a"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="fa"
// CHECK-NEXT: v9 = Call v8 calleeName="fa"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v4, v2, v6, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
