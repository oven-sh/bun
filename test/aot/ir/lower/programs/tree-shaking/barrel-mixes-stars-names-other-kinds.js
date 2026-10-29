// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 9
// STATISTIC: SourceFilesData = 1

// FILE: main.js
// One barrel of a pure package re-exports by name, by star, a star of another barrel, a CommonJS file by name, a JSON file's default, and a name that both a clause and a star have. The program asks for one of each, and each kind has a neighbor nobody asks for.
import { byName, byStar, byInnerStar, fromCommonJS, data, inBoth } from "mixed-barrel";

console.log(byName(), byStar(), byInnerStar(), fromCommonJS(), data.kind, inBoth());

// FILE: node_modules/mixed-barrel/by-name.js
console.log("by-name.js is evaluated");
export function byName() { return "by name"; }

// FILE: node_modules/mixed-barrel/by-star.js
console.log("by-star.js is evaluated");
export function byStar() { return "by star"; }
export function inBoth() { return "the star's"; }

// FILE: node_modules/mixed-barrel/clause-wins.js
console.log("clause-wins.js is evaluated");
export function inBoth() { return "the clause's"; }

// FILE: node_modules/mixed-barrel/common.cjs
exports.fromCommonJS = function () { return "from CommonJS"; };

// FILE: node_modules/mixed-barrel/data.json
{ "kind": "data" }

// FILE: node_modules/mixed-barrel/index.js
export { byName } from "./by-name.js";
export { unaskedName } from "./unasked-name.js";
export * from "./by-star.js";
export * from "./inner/index.js";
export { fromCommonJS } from "./common.cjs";
export { unaskedCommonJS } from "./unasked-common.cjs";
export { default as data } from "./data.json";
export { default as unaskedData } from "./unasked-data.json";
export { inBoth } from "./clause-wins.js";

// FILE: node_modules/mixed-barrel/inner/asked.js
console.log("inner/asked.js is evaluated");
export function byInnerStar() { return "by the star of an inner barrel"; }

// FILE: node_modules/mixed-barrel/inner/index.js
export { byInnerStar } from "./asked.js";
export { unaskedInner } from "./unasked.js";

// FILE: node_modules/mixed-barrel/inner/unasked.js
console.log("inner/unasked.js is evaluated");
export function unaskedInner() {}

// FILE: node_modules/mixed-barrel/package.json
{ "name": "mixed-barrel", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }

// FILE: node_modules/mixed-barrel/unasked-common.cjs
console.log("unasked-common.cjs is evaluated");
exports.unaskedCommonJS = function () {};

// FILE: node_modules/mixed-barrel/unasked-data.json
{ "kind": "unasked" }

// FILE: node_modules/mixed-barrel/unasked-name.js
console.log("unasked-name.js is evaluated");
export function unaskedName() {}

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="byName"
// CHECK-NEXT: v7 = Call v6 calleeName="byName"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="byStar"
// CHECK-NEXT: v11 = Call v10 calleeName="byStar"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="byInnerStar"
// CHECK-NEXT: v15 = Call v14 calleeName="byInnerStar"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v19 = Call v18 calleeName="fromCommonJS"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v21 = String string="data"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="inBoth"
// CHECK-NEXT: v25 = Call v24 calleeName="inBoth"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v27 = Call v4, v2, v8, v12, v16, v20, v22, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
