// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 7

// FILE: main.js
// Which file is the barrel is for package.json to say: an "exports" map with conditions, "browser" beside "main", an "exports" map with a subpath that is a barrel too. Each package has a barrel that must be picked and one that must not, and each barrel has a file nobody asks for.
import { picked as byExports } from "by-exports";
import { picked as byBrowser } from "by-browser";
import { picked as bySubpath } from "by-exports/sub";

console.log(byExports(), byBrowser(), bySubpath());

// FILE: node_modules/by-browser/browser-impl.js
export function picked() { return "by-browser: browser"; }

// FILE: node_modules/by-browser/browser.js
export { picked } from "./browser-impl.js";

// FILE: node_modules/by-browser/impl.js
export function picked() { return "by-browser: main"; }

// FILE: node_modules/by-browser/main.js
export { picked } from "./impl.js";
export { unasked } from "./unasked.js";

// FILE: node_modules/by-browser/package.json
{ "name": "by-browser", "version": "1.0.0", "type": "module", "sideEffects": false, "main": "./main.js", "browser": "./browser.js" }

// FILE: node_modules/by-browser/unasked.js
console.log("by-browser/unasked.js is evaluated");
export function unasked() {}

// FILE: node_modules/by-exports/impl.js
export function picked() { return "by-exports: the bun condition"; }

// FILE: node_modules/by-exports/package.json
{
  "name": "by-exports",
  "version": "1.0.0",
  "type": "module",
  "sideEffects": false,
  "main": "./wrong.js",
  "exports": {
    ".": { "browser": "./wrong.js", "bun": "./right.js", "default": "./wrong.js" },
    "./sub": { "import": "./sub/right.js", "require": "./wrong.js" }
  }
}

// FILE: node_modules/by-exports/right.js
export { picked } from "./impl.js";
export { unasked } from "./unasked.js";

// FILE: node_modules/by-exports/sub/impl.js
export function picked() { return "by-exports/sub: the import condition"; }

// FILE: node_modules/by-exports/sub/right.js
export { picked } from "./impl.js";
export { unasked } from "../unasked.js";

// FILE: node_modules/by-exports/unasked.js
console.log("by-exports/unasked.js is evaluated");
export function unasked() {}

// FILE: node_modules/by-exports/wrong-impl.js
export function picked() { return "by-exports: the wrong file"; }

// FILE: node_modules/by-exports/wrong.js
export { picked } from "./wrong-impl.js";

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="byExports"
// CHECK-NEXT: v7 = Call v6 calleeName="byExports"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="byBrowser"
// CHECK-NEXT: v11 = Call v10 calleeName="byBrowser"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="bySubpath"
// CHECK-NEXT: v15 = Call v14 calleeName="bySubpath"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v4, v2, v8, v12, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
