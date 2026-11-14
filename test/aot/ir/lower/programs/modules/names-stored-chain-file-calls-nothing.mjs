// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// Names stored in a chain by a file that calls nothing and is imported again late.
import d, { a, b } from "./q.cjs"; console.log(typeof d === "object" ? JSON.stringify(d) : d, a, typeof b); globalThis.again = () => import("./q.cjs");

// FILE: q.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.b = exports.a = void 0;
exports.a = 1;
exports.b = 2;
exports.default = 3;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
