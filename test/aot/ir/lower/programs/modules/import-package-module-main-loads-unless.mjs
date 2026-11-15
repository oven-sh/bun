// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 6

// FILE: main.mjs
// The package.json of each package names a CommonJS file as "main" and an ES module as "module". One package is only imported: by a statement, through
// `export { } from` and by `import()`. One is only required. One is imported and required.
import { which as imported } from "only-imported";
import { which as handedOn } from "./barrel.mjs";
import { which as both } from "imported-and-required";
import { onlyRequired, required } from "./requires.cjs";

console.log(imported, handedOn, (await import("only-imported")).which);
console.log(onlyRequired);
console.log(both, required, (await import("imported-and-required")).which);

// FILE: barrel.mjs
export { which } from "only-imported";

// FILE: node_modules/imported-and-required/index.cjs
exports.which = "main";

// FILE: node_modules/imported-and-required/index.mjs
export const which = "module";

// FILE: node_modules/imported-and-required/package.json
{ "name": "imported-and-required", "version": "1.0.0", "main": "./index.cjs", "module": "./index.mjs" }

// FILE: node_modules/only-imported/index.cjs
exports.which = "main";

// FILE: node_modules/only-imported/index.mjs
export const which = "module";

// FILE: node_modules/only-imported/package.json
{ "name": "only-imported", "version": "1.0.0", "main": "./index.cjs", "module": "./index.mjs" }

// FILE: node_modules/only-required/index.cjs
exports.which = "main";

// FILE: node_modules/only-required/index.mjs
export const which = "module";

// FILE: node_modules/only-required/package.json
{ "name": "only-required", "version": "1.0.0", "main": "./index.cjs", "module": "./index.mjs" }

// FILE: requires.cjs
exports.onlyRequired = require("only-required").which;
exports.required = require("imported-and-required").which;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
