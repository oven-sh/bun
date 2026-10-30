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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v6 = PropGet v5 key="c"
// CHECK-NEXT: v7 = Convert v6 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v8 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v9 = PropGet v8 key="e"
// CHECK-NEXT: v10 = Convert v9 declared={type=5 flags=[IsExpected]}
// CHECK-NEXT: v11 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="c"
// CHECK-NEXT: v14 = Convert v13 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v15 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="e"
// CHECK-NEXT: v18 = Convert v17 declared={type=5 flags=[IsExpected]}
// CHECK-NEXT: v19 = Builtin builtin=Object
// CHECK-NEXT: v20 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v21 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v23 = Call v20, v19, v22 calleeName="Object.keys"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="join"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v27 = Call v26, v24 calleeKey="join" calleeName="join"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v29 = Builtin builtin=Object
// CHECK-NEXT: v30 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v31 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v33 = Call v30, v29, v32 calleeName="Object.keys"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v34 key="join"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v37 = Call v36, v34 calleeKey="join" calleeName="join"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v39 = Call v4, v2, v7, v10, v14, v18, v28, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
