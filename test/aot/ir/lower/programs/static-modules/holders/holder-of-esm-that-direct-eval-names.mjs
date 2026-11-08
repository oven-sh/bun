// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3
// CHECK-LABEL: function {{*}}name="f"

// FILE: main.mjs
// A constant that holds what import.meta.require() gave is named by the text of a direct eval: it holds the namespace object, not a stand-in.
const a = import.meta.require("./es.mjs");
console.log(eval("a.x"), typeof eval("a"));
const b = import.meta.require("./m.cjs");
console.log(eval("b.x"), typeof eval("b"));
function f() {
  const c = import.meta.require("./es.mjs");
  return eval("typeof c + c.x");
}
console.log(f());

// FILE: es.mjs
export const x = 4;

// FILE: m.cjs
exports.x = 5;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
