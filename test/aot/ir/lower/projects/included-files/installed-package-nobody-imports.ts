// RUN: lower

// What a package declares globally is declared where a file of the project imports the package, not where the package is only installed: `FromInstalled` names nothing, which stops no build, and its position is untyped.
// CHECK: [[literal]] = Data
// CHECK-NEXT: Convert [[literal]] declared={type=undefined|null|[[FromImported]]
// CHECK: [[installed]] = Data
// CHECK-NOT: Convert [[installed]]
// CHECK: PropGet [[installed]] key="a"

// FILE: src/main.ts
const imported: FromImported = { a: 1 };
const installed: FromInstalled = { a: 2 };
console.log(imported.a, installed.a);

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","types":[]},"include":["src","tests"]}

// FILE: node_modules/imported/package.json
{"name":"imported","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/imported/index.js
exports.value = 1;

// FILE: node_modules/imported/index.d.ts
export declare const value: number;
declare global {
  interface FromImported {
    a: number;
  }
}

// FILE: node_modules/installed/package.json
{"name":"installed","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: node_modules/installed/index.js
exports.value = 1;

// FILE: node_modules/installed/index.d.ts
export declare const value: number;
declare global {
  interface FromInstalled {
    a: number;
  }
}

// FILE: tests/setup.ts
import { value } from "imported";
export const one = value;
