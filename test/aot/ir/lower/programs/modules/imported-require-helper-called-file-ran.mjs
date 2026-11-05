// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.mjs
// In a cycle of imports a file calls the `require` that another file exports before that file has filled the variable.
import "./chunk.mjs";
import { later } from "./runs-first.mjs";
console.log(later());

// FILE: chunk.mjs
import "./runs-first.mjs";
export var __require = /* @__PURE__ */ (x =>
  typeof require !== "undefined"
    ? require
    : typeof Proxy !== "undefined"
      ? new Proxy(x, {
          get: (a, b) => (typeof require !== "undefined" ? require : a)[b],
        })
      : x)(function (x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// FILE: inside.cjs
module.exports = "inside";

// FILE: runs-first.mjs
import { __require } from "./chunk.mjs";
try {
  console.log(__require("./inside.cjs"));
} catch (error) {
  console.log(error.constructor.name);
}
export const later = () => __require("./inside.cjs");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
