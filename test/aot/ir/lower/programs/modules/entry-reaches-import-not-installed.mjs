// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS100151 1

// FILE: main.mjs
// The entry point reaches the module that imports what is not installed by static imports alone: plain Bun fails before the first line runs, and the build is refused.
import "./broken.mjs";
console.log("the entry runs");

// FILE: broken.mjs
import x from "not-installed";
console.log("importer runs", x);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
