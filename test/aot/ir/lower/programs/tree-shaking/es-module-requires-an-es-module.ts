// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5

// FILE: main.ts
// `require` in a TypeScript file that is an ES module itself, import.meta.require, and `import x = require()`.
import viaImportEquals = require("./d");

const { a } = require("./a");
console.log(a());
console.log(import.meta.require("./b").b());
console.log(viaImportEquals.d());
const whole = require("./e");
console.log(whole["e" + ""]());

// FILE: a.ts
export function a() { return "a: require"; }
export function unused() { return "unused"; }

// FILE: b.ts
export function b() { return "b: import.meta.require"; }

// FILE: c.ts
export function c() { return "c: createRequire"; }

// FILE: d.ts
export function d() { return "d: import = require"; }

// FILE: e.ts
export function e() { return "e: a computed name"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
