// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 7

// FILE: main.js
// Three files of the program import the barrel of one pure package: one for nothing at all, one for a name it never uses, one for a name it uses. The barrel has a line of its own that prints.
import "./for-nothing.js";
import "./for-an-unused-name.js";
import { result } from "./for-a-name.js";

console.log(result);

// FILE: for-a-name.js
import { used } from "thrice";
export const result = used();

// FILE: for-an-unused-name.js
import { unused } from "thrice";
console.log("for-an-unused-name.js ran");

// FILE: for-nothing.js
import "thrice";
console.log("for-nothing.js ran");

// FILE: node_modules/thrice/index.js
console.log("the barrel is evaluated");
export { used } from "./used.js";
export { unused } from "./unused.js";
export { neverImported } from "./never-imported.js";

// FILE: node_modules/thrice/never-imported.js
console.log("never-imported.js is evaluated");
export function neverImported() { return "never"; }

// FILE: node_modules/thrice/package.json
{ "name": "thrice", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }

// FILE: node_modules/thrice/unused.js
console.log("unused.js is evaluated");
export function unused() { return "unused"; }

// FILE: node_modules/thrice/used.js
console.log("used.js is evaluated");
export function used() { return "used"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
