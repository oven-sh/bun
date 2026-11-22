// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// Exports stored behind a return that folding removes.
const m = require("./m.cjs");
console.log(m.a, m.b, m.f());

// FILE: m.cjs
exports.a = 1;
if (false) return;
exports.b = 2;
exports.f = function () { return exports.b; };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
