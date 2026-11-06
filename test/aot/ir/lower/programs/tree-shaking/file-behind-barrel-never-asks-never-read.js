// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.js
// "sideEffects": false. The barrel exports four names from four files, and the program asks for one. Of the others, one file is no JavaScript, one does not exist, and one imports a package that is not installed. `bun build --compile` never reads them, so the build succeeds; `bun run` fails.
import { wanted } from "half-written";

console.log(wanted());

// FILE: node_modules/half-written/broken.js
export function broken( { return "this file does not parse";

// FILE: node_modules/half-written/index.js
export { wanted } from "./wanted.js";
export { broken } from "./broken.js";
export { absent } from "./absent.js";
export { needy } from "./needy.js";

// FILE: node_modules/half-written/needy.js
import { helper } from "a-package-that-is-not-installed";
export function needy() { return helper(); }

// FILE: node_modules/half-written/package.json
{ "name": "half-written", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }

// FILE: node_modules/half-written/wanted.js
export function wanted() { return "wanted"; }

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="wanted"
// CHECK-NEXT: v7 = Call v6 calleeName="wanted"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v4, v2, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
