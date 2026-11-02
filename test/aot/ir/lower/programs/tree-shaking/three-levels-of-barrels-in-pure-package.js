// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 9

// FILE: main.js
// "sideEffects": false. The name passes three barrels; every file of the package prints when it is evaluated, the barrels too. `bun run` evaluates all nine files. `bun build --compile` evaluates helper.js, leaf.js, level-2.js and level-1.js: it leaves out the three files of which nothing is used, and index.js, whose `export *` it passes through.
import { leaf } from "deep-barrels";

console.log(leaf());

// FILE: node_modules/deep-barrels/beside-1.js
console.log("beside-1.js is evaluated");
export function beside1() { return "beside 1"; }

// FILE: node_modules/deep-barrels/beside-2.js
console.log("beside-2.js is evaluated");
export function beside2() { return "beside 2"; }

// FILE: node_modules/deep-barrels/helper.js
console.log("helper.js is evaluated");
export function helper() { return "helper"; }

// FILE: node_modules/deep-barrels/index.js
console.log("index.js is evaluated");
export * from "./level-1.js";
export * from "./beside-1.js";

// FILE: node_modules/deep-barrels/leaf.js
console.log("leaf.js is evaluated");
import { helper } from "./helper.js";
export function leaf() { return "leaf, " + helper(); }

// FILE: node_modules/deep-barrels/level-1.js
console.log("level-1.js is evaluated");
export { leaf, otherLeaf } from "./level-2.js";
export * from "./beside-2.js";

// FILE: node_modules/deep-barrels/level-2.js
console.log("level-2.js is evaluated");
import { leaf } from "./leaf.js";
import { otherLeaf } from "./other-leaf.js";
export { leaf, otherLeaf };

// FILE: node_modules/deep-barrels/other-leaf.js
console.log("other-leaf.js is evaluated");
export function otherLeaf() { return "other leaf"; }

// FILE: node_modules/deep-barrels/package.json
{ "name": "deep-barrels", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="leaf"
// CHECK-NEXT: v7 = Call v6 calleeName="leaf"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v4, v2, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
