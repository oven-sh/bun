// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4
// STATISTIC: SourceFilesDemoted = 1

// FILE: main.ts
// `const { default: d, a } = await import(..)` of CommonJS files.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
const { default: d, a } = await import("./m.cjs");
console.log(a, d.a, d.b, typeof d);
const { default: own, a: ofMarked, __esModule: flag } = await import("./marked.cjs");
console.log(typeof own === "string" ? own : Object.keys(own).sort().join(), ofMarked, String(flag));
const { default: handed } = await import("./handed.cjs");
console.log(Object.keys(handed).join(), JSON.stringify(handed));

// FILE: handed.cjs
exports.a = "a of handed";

// FILE: m.cjs
exports.a = "a"; exports.b = "b";

// FILE: marked.cjs
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = "own default"; exports.a = "a of marked";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
