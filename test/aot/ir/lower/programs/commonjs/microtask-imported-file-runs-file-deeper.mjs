// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.mjs
// A microtask of an imported file runs before a file of a deeper module.
import { first } from "./first.cjs";
import { deeper } from "./module.mjs";
console.log(first, deeper, globalThis.seen);

// FILE: deeper.cjs
exports.deeper = globalThis.seen;

// FILE: first.cjs
globalThis.seen = "early";
exports.first = 1;
queueMicrotask(() => {
  globalThis.seen = "late";
});

// FILE: module.mjs
export { deeper } from "./deeper.cjs";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
