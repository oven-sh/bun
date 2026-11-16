// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.mjs
// A module on a cycle reads bindings that are not yet made.
import { a, fa } from "./a.mjs";
console.log(a, fa());

// FILE: a.mjs
import { b } from "./b.mjs";
export const a = "a" + b;
export function fa() { return "fa" + a; }
export default class D {}

// FILE: b.mjs
import D, { a, fa } from "./a.mjs";
let r = [];
for (const f of [() => a, () => fa(), () => D, () => typeof fa]) { try { r.push(String(f())); } catch (e) { r.push(e.name); } }
export const b = r.join();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
