// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A CommonJS file has `__esModule`, a `default` of its own and getters that return bindings of its top level. A module takes the names out of
// what `import()` gives by a pattern.
const { number, greet } = await import("./file.cjs");
console.log(number, greet());

// FILE: file.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "number", { enumerable: true, get: function () { return number; } });
Object.defineProperty(exports, "greet", { enumerable: true, get: function () { return greet; } });
const number = 1;
function greet() {
  return "hello " + number;
}
exports.default = "own default";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
