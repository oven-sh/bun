// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// values.js is imported for one name. Its other exports are read by nobody, and their initializers call something, are marked pure, or are plain values. `bun run` runs all of them. `bun build --compile` drops the call marked pure and nothing else, and --aot follows it.
import { used, log } from "./values.js";

console.log(used);
console.log(log.join("\n"));

// FILE: values.js
export const log = [];
function effect(name) { log.push(name); return name; }

export const used = effect("used");
export const unusedCall = effect("an unused export with a call");
export const unusedMarked = /* @__PURE__ */ effect("an unused export with a call marked pure");
export const unusedPlain = 1;
export let unusedLet = effect("an unused let");
export var unusedVar = effect("an unused var");
export class UnusedClass { static field = effect("a static field of an unused exported class"); }
export default effect("an unused default export");
export const { unusedFromPattern = effect("a default in the pattern of an unused export") } = {};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
