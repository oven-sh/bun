// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.mjs
// A CommonJS file stores a name under an `if`, an ES module hands it on with `export *`, a second CommonJS file has a getter over it, and this module imports the name from that file.
import { one } from "./over.cjs";
console.log(one);

// FILE: between.mjs
export * from "./lib.cjs";

// FILE: lib.cjs
if (process.argv.length <= 99) exports.one = 1;

// FILE: over.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var below_1 = require("./between.mjs");
Object.defineProperty(exports, "one", {
  enumerable: true,
  get: function () {
    return below_1.one;
  },
});

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
