// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 7

// FILE: main.js
// Six packages, alike but for "sideEffects": false, true, an empty list, a string, a list that names another file, and none at all. Each is imported for a name that is not used and each prints when it is evaluated. `bun run` evaluates all six. `bun build --compile` leaves out the ones that say false, an empty list and a list that names another file; true, a string and no field at all keep the file. --aot follows it.
import { unused as a } from "says-false";
import { unused as b } from "says-true";
import { unused as c } from "says-empty-list";
import { unused as d } from "says-a-string";
import { unused as e } from "says-another-file";
import { unused as f } from "says-nothing";

console.log("main.js runs");

// FILE: node_modules/says-a-string/index.js
console.log("says-a-string is evaluated");
export function unused() {}

// FILE: node_modules/says-a-string/package.json
{ "name": "says-a-string", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": "./index.js" }

// FILE: node_modules/says-another-file/index.js
console.log("says-another-file is evaluated");
export function unused() {}

// FILE: node_modules/says-another-file/package.json
{ "name": "says-another-file", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": ["./other.js"] }

// FILE: node_modules/says-empty-list/index.js
console.log("says-empty-list is evaluated");
export function unused() {}

// FILE: node_modules/says-empty-list/package.json
{ "name": "says-empty-list", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": [] }

// FILE: node_modules/says-false/index.js
console.log("says-false is evaluated");
export function unused() {}

// FILE: node_modules/says-false/package.json
{ "name": "says-false", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }

// FILE: node_modules/says-nothing/index.js
console.log("says-nothing is evaluated");
export function unused() {}

// FILE: node_modules/says-nothing/package.json
{ "name": "says-nothing", "version": "1.0.0", "type": "module", "main": "index.js" }

// FILE: node_modules/says-true/index.js
console.log("says-true is evaluated");
export function unused() {}

// FILE: node_modules/says-true/package.json
{ "name": "says-true", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": true }

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
// CHECK-NEXT: v5 = String string="main.js runs"
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
