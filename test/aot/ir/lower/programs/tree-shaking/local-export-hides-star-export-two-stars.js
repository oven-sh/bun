// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.js
// barrel.ts declares `hidden` itself, so the one behind `export *` is not the one that is imported. `clash` comes from two stars, so the namespace does not have it. `same` comes from two stars but is one binding, so it is there.
import { hidden, same } from "./barrel";
import * as barrel from "./barrel";

console.log(hidden(), same());
console.log(Object.keys(barrel).join(), "clash" in barrel);

// FILE: barrel.js
export * from "./left";
export * from "./right";
export function hidden() { return "hidden of the barrel"; }

// FILE: left.js
export function hidden() { return "hidden of left"; }
export function clash() { return "clash of left"; }
export { same } from "./shared";

// FILE: right.js
export function clash() { return "clash of right"; }
export { same } from "./shared";

// FILE: shared.js
export function same() { return "same"; }

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="hidden"
// CHECK-NEXT: v7 = Call v6 calleeName="hidden"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="same"
// CHECK-NEXT: v10 = Call v9 calleeName="same"
// CHECK-NEXT: v11 = Call v4, v2, v7, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = Builtin builtin=Object
// CHECK-NEXT: v18 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v19 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v20 = Call v18, v17, v19 calleeName="Object.keys"
// CHECK-NEXT: v21 = PropGet v20 key="join"
// CHECK-NEXT: v22 = Call v21, v20 calleeKey="join" calleeName="join"
// CHECK-NEXT: v23 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v24 = PropHas v23 key="clash"
// CHECK-NEXT: v25 = Call v16, v14, v22, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
