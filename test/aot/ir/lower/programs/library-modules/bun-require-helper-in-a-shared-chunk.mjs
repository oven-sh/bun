// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// `bun build --splitting --target=node` exports `__require = createRequire(import.meta.url)` from a shared chunk.
import { __require, metaRequire } from "./chunk.mjs";

console.log(__require("node:zlib").gunzipSync(__require("zlib").gzipSync("text")).toString());
console.log(metaRequire("node:querystring").stringify({ a: 1 }));

// FILE: chunk.mjs
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);
export var metaRequire = import.meta.require;
export { __require };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
