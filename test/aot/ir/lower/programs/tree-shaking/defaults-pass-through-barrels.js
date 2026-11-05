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
