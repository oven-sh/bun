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
