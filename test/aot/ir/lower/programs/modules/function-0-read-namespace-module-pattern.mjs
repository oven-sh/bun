// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="g"
// CHECK-LABEL: function {{*}}name="value"

// FILE: main.mjs
// A function under 0 is read from the namespace of the module itself by a pattern.
import * as h from "./main.mjs";
const value = function () { return 1; };
export { value as "0" };
const { "0": q } = h;
console.log(g(q), g(() => 2));
function g(v) { return typeof v === "function" ? v() : typeof v; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
