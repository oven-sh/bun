// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3
// CHECK-LABEL: function {{*}}name="take"
// CHECK-LABEL: function {{*}}name="f"

// FILE: main.mjs
// An object under Infinity is read from a namespace behind a star by the pattern of a parameter.
import * as h from "./between.mjs";
const q = take(h);
function take({ "Infinity": found }) { return found; }
console.log(f(q), f([1]));
function f(v) { return Array.isArray(v) ? v.length : typeof v; }

// FILE: between.mjs
export * from "./other.mjs";

// FILE: other.mjs
const value = { tag: 1 };
export { value as "Infinity" };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
