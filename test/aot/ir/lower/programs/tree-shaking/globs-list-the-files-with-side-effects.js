// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 8

// FILE: main.js
// "sideEffects" holds two globs: "./polyfills/*.js" and "**/*.setup.js". index.js imports five files for their effects; three match. `bun run` reports all five. `bun build --compile` reports polyfills/one.js, three.setup.js and lib/four.setup.js, and --aot follows it.
import { report } from "globbed";

console.log(report());

// FILE: node_modules/globbed/five.js
import { seen } from "./seen.js";
seen.push("five.js");

// FILE: node_modules/globbed/index.js
import "./polyfills/one.js";
import "./polyfills/nested/two.js";
import "./three.setup.js";
import "./lib/four.setup.js";
import "./five.js";
import { seen } from "./seen.js";
export function report() { return seen.join(", ") || "nothing"; }

// FILE: node_modules/globbed/lib/four.setup.js
import { seen } from "../seen.js";
seen.push("lib/four.setup.js");

// FILE: node_modules/globbed/package.json
{ "name": "globbed", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": ["./polyfills/*.js", "**/*.setup.js"] }

// FILE: node_modules/globbed/polyfills/nested/two.js
import { seen } from "../../seen.js";
seen.push("polyfills/nested/two.js");

// FILE: node_modules/globbed/polyfills/one.js
import { seen } from "../seen.js";
seen.push("polyfills/one.js");

// FILE: node_modules/globbed/seen.js
export const seen = [];

// FILE: node_modules/globbed/three.setup.js
import { seen } from "./seen.js";
seen.push("three.setup.js");

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="report"
// CHECK-NEXT: v7 = Call v6 calleeName="report"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v4, v2, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
