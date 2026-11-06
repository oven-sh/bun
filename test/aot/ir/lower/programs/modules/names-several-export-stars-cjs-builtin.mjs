// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 27
// STATISTIC: SourceFilesData = 1

// FILE: main.mjs
// Modules with two to seven `export *` over CommonJS files, built-in modules, data and ES modules. A second module exports one name of each again, by name, and a
// third has `export *` over the second.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
for (const kind of [
  "commonjs-and-an-object-literal",
  "commonjs-and-computed-keys",
  "two-built-in-modules",
  "commonjs-and-a-built-in-module",
  "commonjs-data-and-a-built-in-module",
  "a-module-between-two-commonjs-files",
  "seven",
]) {
  const names = await import(`./names-of-${kind}.mjs`);
  const star = require(`./star-over-${kind}.mjs`);
  console.log(kind, JSON.stringify(names), Object.keys(names).join(), JSON.stringify(star), Object.keys(star).join());
}

// FILE: computed.cjs
for (const key of ["u", "v"]) exports[key] = key + "!";

// FILE: data.json
{ "j": 7, "k": 8 }

// FILE: index-of-a-module-between-two-commonjs-files.mjs
export * from "./inner.cjs";
export * from "./plain.mjs";
export * from "./other.cjs";

// FILE: index-of-commonjs-and-a-built-in-module.mjs
export * from "./inner.cjs";
export * from "node:path";

// FILE: index-of-commonjs-and-an-object-literal.mjs
export * from "./inner.cjs";
export * from "./literal.cjs";

// FILE: index-of-commonjs-and-computed-keys.mjs
export * from "./computed.cjs";
export * from "./inner.cjs";

// FILE: index-of-commonjs-data-and-a-built-in-module.mjs
export * from "./inner.cjs";
export * from "./data.json";
export * from "node:path";

// FILE: index-of-seven.mjs
export * from "./inner.cjs";
export * from "./other.cjs";
export * from "./literal.cjs";
export * from "./computed.cjs";
export * from "./data.json";
export * from "node:path";
export * from "./plain.mjs";

// FILE: index-of-two-built-in-modules.mjs
export * from "node:path";
export * from "node:os";

// FILE: inner.cjs
exports.c = 1;

// FILE: literal.cjs
module.exports = { t: 3 };

// FILE: names-of-a-module-between-two-commonjs-files.mjs
export { c, p, e } from "./index-of-a-module-between-two-commonjs-files.mjs";

// FILE: names-of-commonjs-and-a-built-in-module.mjs
export { c, sep } from "./index-of-commonjs-and-a-built-in-module.mjs";

// FILE: names-of-commonjs-and-an-object-literal.mjs
export { c, t } from "./index-of-commonjs-and-an-object-literal.mjs";

// FILE: names-of-commonjs-and-computed-keys.mjs
export { u, c } from "./index-of-commonjs-and-computed-keys.mjs";

// FILE: names-of-commonjs-data-and-a-built-in-module.mjs
export { c, j, sep } from "./index-of-commonjs-data-and-a-built-in-module.mjs";

// FILE: names-of-seven.mjs
export { c, e, t, u, j, sep, p } from "./index-of-seven.mjs";

// FILE: names-of-two-built-in-modules.mjs
export { sep, EOL } from "./index-of-two-built-in-modules.mjs";

// FILE: other.cjs
exports.e = 5;

// FILE: plain.mjs
export const p = 9;

// FILE: star-over-a-module-between-two-commonjs-files.mjs
export * from "./names-of-a-module-between-two-commonjs-files.mjs";

// FILE: star-over-commonjs-and-a-built-in-module.mjs
export * from "./names-of-commonjs-and-a-built-in-module.mjs";

// FILE: star-over-commonjs-and-an-object-literal.mjs
export * from "./names-of-commonjs-and-an-object-literal.mjs";

// FILE: star-over-commonjs-and-computed-keys.mjs
export * from "./names-of-commonjs-and-computed-keys.mjs";

// FILE: star-over-commonjs-data-and-a-built-in-module.mjs
export * from "./names-of-commonjs-data-and-a-built-in-module.mjs";

// FILE: star-over-seven.mjs
export * from "./names-of-seven.mjs";

// FILE: star-over-two-built-in-modules.mjs
export * from "./names-of-two-built-in-modules.mjs";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
