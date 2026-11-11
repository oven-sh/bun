// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4
// CHECK-LABEL: function {{*}}name="Sub"

// FILE: main.js
// "sideEffects": false, and index.js only has `export *`, so the imports go past it and the file is not in the executable. Its namespace object is read by constant names in every way there is; a name that it lacks asks the object itself.
import * as ns from "stars";

console.log(ns?.a(), ns["a"](), ns.a?.(), (0, ns.a)());
console.log(typeof ns.a, new ns.Klass().m(), ns.value + 1, `${ns.value}`);
const kept = ns.a;
console.log(kept());
class Sub extends ns.Klass {}
console.log(new Sub().m(), new Sub() instanceof ns.Klass);

// FILE: node_modules/stars/a.js
export function a() { return "a"; }
export const value = 7;
export class Klass { m() { return "m"; } }

// FILE: node_modules/stars/b.js
export function b() { return "b"; }

// FILE: node_modules/stars/index.js
export * from "./a.js";
export * from "./b.js";

// FILE: node_modules/stars/package.json
{ "name": "stars", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
