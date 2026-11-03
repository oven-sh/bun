// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 7

// FILE: main.js
// "pure" says "sideEffects": false and re-exports from "impure", which says nothing and prints. The program uses a name of pure that has nothing to do with impure, then, in a second file, one that comes from it. `bun run` evaluates impure/never.js, impure/bare.js and impure/passed-on.js. `bun build --compile` leaves impure/never.js out: the re-export in pure/index.js is not used. The bare import in the same file stays.
import { own } from "pure";
import { second } from "./second.js";

console.log(own(), second());

// FILE: node_modules/impure/bare.js
console.log("impure/bare.js is evaluated");

// FILE: node_modules/impure/never.js
console.log("impure/never.js is evaluated");
export function never() { return "never"; }

// FILE: node_modules/impure/package.json
{ "name": "impure", "version": "1.0.0", "type": "module" }

// FILE: node_modules/impure/passed-on.js
console.log("impure/passed-on.js is evaluated");
export function passedOn() { return "passed on"; }

// FILE: node_modules/pure/index.js
export { own } from "./own.js";
export { never } from "impure/never.js";
import "impure/bare.js";

// FILE: node_modules/pure/own.js
export function own() { return "own"; }

// FILE: node_modules/pure/package.json
{ "name": "pure", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }

// FILE: node_modules/pure/passes.js
export { passedOn } from "impure/passed-on.js";

// FILE: second.js
import { passedOn } from "pure/passes.js";
export function second() { return passedOn(); }

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="own"
// CHECK-NEXT: v7 = Call v6 calleeName="own"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="second"
// CHECK-NEXT: v11 = Call v10 calleeName="second"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v4, v2, v8, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
