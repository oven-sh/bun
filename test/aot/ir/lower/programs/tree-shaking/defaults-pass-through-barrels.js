// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 7

// FILE: main.js
// A default export passes barrels in every way: `export { default } from`, a default that becomes a name, a name that becomes the default, a barrel that re-exports another barrel's default, and an import of a default that a clause exports again. Of each pair one is asked for.
import theDefault, { wasDefault, fromInnerBarrel, viaClause } from "defaults";

console.log(theDefault(), wasDefault(), fromInnerBarrel(), viaClause());

// FILE: node_modules/defaults/becomes-default.js
console.log("becomes-default.js is evaluated");
export function becomesDefault() { return "a name that became the default"; }

// FILE: node_modules/defaults/clause.js
console.log("clause.js is evaluated");
export default function () { return "a default exported by a clause"; }

// FILE: node_modules/defaults/index.js
import clause from "./clause.js";
import unusedClause from "./unused-clause.js";
export { becomesDefault as default } from "./becomes-default.js";
export { default as wasDefault } from "./was-default.js";
export { default as unusedDefault } from "./unused-default.js";
export { default as fromInnerBarrel } from "./inner/index.js";
export { other as unusedFromInnerBarrel } from "./inner/index.js";
export { clause as viaClause, unusedClause };

// FILE: node_modules/defaults/inner/impl.js
console.log("inner/impl.js is evaluated");
export default function () { return "the default of an inner barrel"; }

// FILE: node_modules/defaults/inner/index.js
export { default } from "./impl.js";
export { other } from "./other.js";

// FILE: node_modules/defaults/inner/other.js
console.log("inner/other.js is evaluated");
export function other() { return "never"; }

// FILE: node_modules/defaults/package.json
{ "name": "defaults", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }

// FILE: node_modules/defaults/unused-clause.js
console.log("unused-clause.js is evaluated");
export default function () { return "never"; }

// FILE: node_modules/defaults/unused-default.js
console.log("unused-default.js is evaluated");
export default function () { return "never"; }

// FILE: node_modules/defaults/was-default.js
console.log("was-default.js is evaluated");
export default function () { return "a default that became a name"; }

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="theDefault"
// CHECK-NEXT: v7 = Call v6 calleeName="theDefault"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="wasDefault"
// CHECK-NEXT: v11 = Call v10 calleeName="wasDefault"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="fromInnerBarrel"
// CHECK-NEXT: v15 = Call v14 calleeName="fromInnerBarrel"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="viaClause"
// CHECK-NEXT: v19 = Call v18 calleeName="viaClause"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v21 = Call v4, v2, v8, v12, v16, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
