// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5
// CHECK-LABEL: function {{*}}name="neverRequires"
// CHECK-LABEL: function {{*}}name="requires"
// CHECK-LABEL: function {{*}}name="imports"

// FILE: main.js
// require() and import() inside functions that nobody calls load nothing. The same calls inside a function that is called load their files then, and what they return is whole.
function neverRequires() { return require("./never-required.js"); }
const neverImports = () => import("./never-imported.js");
function requires() { return require("./required.js"); }
async function imports() { return import("./imported.js"); }

console.log("before");
console.log(requires()["na" + "me"]());
console.log((await imports())["na" + "me"]());

// FILE: imported.js
console.log("imported.js is evaluated");
export function name() { return "imported"; }

// FILE: never-imported.js
console.log("never-imported.js is evaluated");
export function name() { return "never imported"; }

// FILE: never-required.js
console.log("never-required.js is evaluated");
export function name() { return "never required"; }

// FILE: required.js
console.log("required.js is evaluated");
export function name() { return "required"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
