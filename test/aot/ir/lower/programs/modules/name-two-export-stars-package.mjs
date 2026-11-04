// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 8

// FILE: main.mjs
// The module with two `export *` over CommonJS files belongs to a package whose package.json says "sideEffects": false. The program, and a second such package,
// export a name of it again.
import { e } from "q";
import * as quiet from "q/barrel.mjs";
import * as barrel from "./barrel.mjs";
import { c } from "./barrel.mjs";

console.log(c, e, barrel.c, quiet.e, Object.keys(barrel).join(), Object.keys(quiet).join());

// FILE: barrel.mjs
export * from "./second.mjs";

// FILE: node_modules/p/index.mjs
export * from "./inner.cjs";
export * from "./other.cjs";

// FILE: node_modules/p/inner.cjs
exports.c = 1;

// FILE: node_modules/p/other.cjs
exports.e = 5;

// FILE: node_modules/p/package.json
{ "name": "p", "main": "./index.mjs", "sideEffects": false }

// FILE: node_modules/q/barrel.mjs
export * from "./second.mjs";

// FILE: node_modules/q/package.json
{ "name": "q", "main": "./second.mjs", "sideEffects": false }

// FILE: node_modules/q/second.mjs
export { e } from "p";

// FILE: second.mjs
export { c } from "p";

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
// CHECK-NEXT: v5 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v6 = PropGet v5 key="c"
// CHECK-NEXT: v7 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v8 = PropGet v7 key="e"
// CHECK-NEXT: v9 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v10 = PropGet v9 key="c"
// CHECK-NEXT: v11 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v12 = PropGet v11 key="e"
// CHECK-NEXT: v13 = Builtin builtin=Object
// CHECK-NEXT: v14 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v15 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v16 = Call v14, v13, v15 calleeName="Object.keys"
// CHECK-NEXT: v17 = PropGet v16 key="join"
// CHECK-NEXT: v18 = Call v17, v16 calleeKey="join" calleeName="join"
// CHECK-NEXT: v19 = Builtin builtin=Object
// CHECK-NEXT: v20 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v21 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v22 = Call v20, v19, v21 calleeName="Object.keys"
// CHECK-NEXT: v23 = PropGet v22 key="join"
// CHECK-NEXT: v24 = Call v23, v22 calleeKey="join" calleeName="join"
// CHECK-NEXT: v25 = Call v4, v2, v6, v8, v10, v12, v18, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
