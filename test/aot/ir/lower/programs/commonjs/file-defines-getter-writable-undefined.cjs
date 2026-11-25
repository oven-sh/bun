// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// Object.defineProperty refuses a getter beside `writable`, whatever `writable` holds.
process.on("uncaughtException", error => console.log("uncaught", error.name, error.message));
const lib = require("./lib.cjs");
console.log(lib.a);

// FILE: lib.cjs
"use strict";
const held = 41;
Object.defineProperty(exports, "a", { enumerable: true, get: function () { return held; }, writable: undefined });

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
