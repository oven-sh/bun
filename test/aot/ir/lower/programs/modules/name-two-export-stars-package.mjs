// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 8

// FILE: main.mjs
// The module with two `export *` over CommonJS files belongs to a package whose package.json says "sideEffects": false. The program, and a second such package,
// export a name of it again.
import { e } from "q";
import * as quiet from "q/barrel.mjs";
import * as barrel from "./barrel.mjs";
import { c } from "./barrel.mjs";

console.log(c, e, barrel.c, quiet.e, Object.keys(barrel).join(), Object.keys(quiet).join());

// FILE: barrel.mjs
export * from "./second.mjs";

// FILE: node_modules/p/index.mjs
export * from "./inner.cjs";
export * from "./other.cjs";

// FILE: node_modules/p/inner.cjs
exports.c = 1;

// FILE: node_modules/p/other.cjs
exports.e = 5;

// FILE: node_modules/p/package.json
{ "name": "p", "main": "./index.mjs", "sideEffects": false }

// FILE: node_modules/q/barrel.mjs
export * from "./second.mjs";

// FILE: node_modules/q/package.json
{ "name": "q", "main": "./second.mjs", "sideEffects": false }

// FILE: node_modules/q/second.mjs
export { e } from "p";

// FILE: second.mjs
export { c } from "p";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
