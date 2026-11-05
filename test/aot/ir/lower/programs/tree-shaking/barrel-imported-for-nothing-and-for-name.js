// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 7

// FILE: main.js
// Three files of the program import the barrel of one pure package: one for nothing at all, one for a name it never uses, one for a name it uses. The barrel has a line of its own that prints.
import "./for-nothing.js";
import "./for-an-unused-name.js";
import { result } from "./for-a-name.js";

console.log(result);

// FILE: for-a-name.js
import { used } from "thrice";
export const result = used();

// FILE: for-an-unused-name.js
import { unused } from "thrice";
console.log("for-an-unused-name.js ran");

// FILE: for-nothing.js
import "thrice";
console.log("for-nothing.js ran");

// FILE: node_modules/thrice/index.js
console.log("the barrel is evaluated");
export { used } from "./used.js";
export { unused } from "./unused.js";
export { neverImported } from "./never-imported.js";

// FILE: node_modules/thrice/never-imported.js
console.log("never-imported.js is evaluated");
export function neverImported() { return "never"; }

// FILE: node_modules/thrice/package.json
{ "name": "thrice", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }

// FILE: node_modules/thrice/unused.js
console.log("unused.js is evaluated");
export function unused() { return "unused"; }

// FILE: node_modules/thrice/used.js
console.log("used.js is evaluated");
export function used() { return "used"; }

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="result"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v4, v2, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
