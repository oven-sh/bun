// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A commonjs file requires the entry point that hands on all its names.
export * from "./lib.cjs";
export const own = "main.own";
console.log("main runs");

// FILE: lib.cjs
console.log("lib begins");
exports.first = 1;
const main = require("./main.mjs");
console.log("lib: required", Object.keys(main).join(), main.first, main.second, main.own);
exports.second = 2;
console.log("lib ends");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
