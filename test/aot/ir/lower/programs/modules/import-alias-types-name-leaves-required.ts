// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// `import C = ns.C` is named by a type alone, and `import n = ns.n` by nothing.
import ns = require("./lib");
import C = ns.C;
import n = ns.n;
let c: C | undefined;
console.log(typeof c, ns.s);

// FILE: lib.ts
export const n = 10;
export function f(a: number) {
  return a + 1;
}
export class C {
  v = 7;
}
export const s = "s";
console.log("lib runs");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
