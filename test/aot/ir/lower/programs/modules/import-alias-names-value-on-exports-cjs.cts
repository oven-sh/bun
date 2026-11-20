// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesDemoted = 1

// FILE: main.cts
// lib.cts says `import n = exports.n` and `import all = module.exports`, which the type checker is told not to look at.
const lib = require("./lib.cts");
console.log(lib.n, lib.more, lib.keys);

// FILE: lib.cts
// @ts-nocheck
exports.n = 10;
import n = exports.n;
import all = module.exports;
exports.more = n + 1;
exports.keys = Object.keys(all).join();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
