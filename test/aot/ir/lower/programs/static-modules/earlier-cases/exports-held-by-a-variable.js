// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// `var e = exports` and stores through it.
const lib = require("./lib");
console.log(lib.a, lib.b, lib.c(), lib.d());

// FILE: lib.js
"use strict";
var utils = exports;
const same = module.exports;
utils.a = "a";
same.b = "b";
exports.c = function () { return utils.a + same.b; };
utils.d = function () { return utils.c(); };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
