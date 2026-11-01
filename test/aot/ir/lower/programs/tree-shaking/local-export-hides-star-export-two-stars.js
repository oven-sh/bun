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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="hidden"
// CHECK-NEXT: v7 = Call v6 calleeName="hidden"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="same"
// CHECK-NEXT: v11 = Call v10 calleeName="same"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v4, v2, v8, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = Builtin builtin=Object
// CHECK-NEXT: v20 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v21 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v23 = Call v20, v19, v22 calleeName="Object.keys"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="join"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v27 = Call v26, v24 calleeKey="join" calleeName="join"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v29 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v31 = PropHas v30 key="clash"
// CHECK-NEXT: v32 = Call v18, v16, v28, v31 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v33 = Undefined
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
