// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5

// FILE: main.ts
// outer.ts says `export * as inner from`. Its importers read inner by name, by a computed name, through a namespace of the namespace, and through a pattern.
import * as outer from "./outer";
import { inner, renamedInner } from "./outer";

console.log(outer.inner.byTwoMembers());
console.log(inner.byNamedImport());
console.log((outer.inner as any)["by" + "Computed"]());
console.log((outer as any)["in" + "ner"].byComputedOuter());
const { inner: { byPattern } } = outer;
console.log(byPattern());
console.log(renamedInner.deepest.threeDown());
console.log(Object.keys(outer.renamedInner.deepest).join());

// FILE: deepest.ts
export function threeDown() { return "three down"; }
export function listedOnly() { return "listed only"; }

// FILE: inner.ts
export function byTwoMembers() { return "by two members"; }
export function byNamedImport() { return "by named import"; }
export function byComputed() { return "by computed"; }
export function byComputedOuter() { return "by computed outer"; }
export function byPattern() { return "by pattern"; }

// FILE: middle.ts
import * as deepest from "./deepest";
export { deepest };

// FILE: outer.ts
export * as inner from "./inner";
export * as renamedInner from "./middle";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
