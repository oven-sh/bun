// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A package in the output of bun build asks whether require is there.
import kindOfModule, { kindOfRequire } from "built-by-bun";
console.log(kindOfModule, kindOfRequire);

// FILE: node_modules/built-by-bun/index.js
// @bun
export const kindOfRequire = typeof require === "function" ? "has require" : "has no require";
export default typeof module;

// FILE: node_modules/built-by-bun/package.json
{ "name": "built-by-bun", "main": "index.js" }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
