// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.mjs
// A CommonJS file as tsc emits it, with a default of its own, hands on names of an ES module behind getters. Imports through `export *` take some of them, and nothing reads the others.
import { first, bump } from "./barrel.mjs";
import { first as again } from "./outer-barrel.mjs";
bump();
console.log(first, again);

// FILE: barrel.mjs
export * from "./emitted.cjs";

// FILE: classes.mjs
console.log("classes.mjs runs");
export class Unread {}
export let count = 0;
export function bump() {
  count++;
  console.log("bumped to", count);
}

// FILE: emitted.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bump = exports.count = exports.Unread = exports.first = void 0;
exports.first = 1;
exports.default = 2;
var classes_1 = require("./classes.mjs");
Object.defineProperty(exports, "Unread", { enumerable: true, get: function () { return classes_1.Unread; } });
Object.defineProperty(exports, "count", { enumerable: true, get: function () { return classes_1.count; } });
Object.defineProperty(exports, "bump", { enumerable: true, get: function () { return classes_1.bump; } });

// FILE: outer-barrel.mjs
export * from "./barrel.mjs";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
