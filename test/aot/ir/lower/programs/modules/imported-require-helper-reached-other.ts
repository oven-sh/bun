// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 9

// FILE: main.ts
// The `require` of another file comes through `export .. from`, a default export, a namespace import and a constant of this file.
import * as chunk from "./chunk.mjs";
import byDefault, { __require } from "./chunk.mjs";
import again from "./passes-it-on-again.mjs";
import { load } from "./passes-it-on.mjs";
const alias = __require;
const text: string = alias("./alias.cjs");
console.log(load("./reexported.cjs"), again("./reexported-twice.cjs"), byDefault("./default-export.cjs"));
console.log(chunk.__require("./namespace.cjs"), text, (__require as (name: string) => string)("./asserted.cjs"));

// FILE: alias.cjs
module.exports = "alias";

// FILE: asserted.cjs
module.exports = "asserted";

// FILE: chunk.mjs
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
export default __require;

// FILE: default-export.cjs
module.exports = "default-export";

// FILE: namespace.cjs
module.exports = "namespace";

// FILE: passes-it-on-again.mjs
import { load } from "./passes-it-on.mjs";
export { load as default };

// FILE: passes-it-on.mjs
export { __require as load } from "./chunk.mjs";

// FILE: reexported-twice.cjs
module.exports = "reexported-twice";

// FILE: reexported.cjs
module.exports = "reexported";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
