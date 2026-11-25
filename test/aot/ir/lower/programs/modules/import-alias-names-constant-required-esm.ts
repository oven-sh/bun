// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// `import n = ns.n` is the only mention of what `import ns = require(..)` of an ES module answers.
import ns = require("./lib");
import n = ns.n;
console.log(n + 1);

// FILE: lib.ts
export const n = 10;
export function f(a: number) {
  return a + 1;
}
export class C {
  v = 7;
}
export const s = "s";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
