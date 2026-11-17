// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 9
// STATISTIC: SourceFilesData = 1

// FILE: main.js
// One barrel of a pure package re-exports by name, by star, a star of another barrel, a CommonJS file by name, a JSON file's default, and a name that both a clause and a star have. The program asks for one of each, and each kind has a neighbor nobody asks for.
import { byName, byStar, byInnerStar, fromCommonJS, data, inBoth } from "mixed-barrel";

console.log(byName(), byStar(), byInnerStar(), fromCommonJS(), data.kind, inBoth());

// FILE: node_modules/mixed-barrel/by-name.js
console.log("by-name.js is evaluated");
export function byName() { return "by name"; }

// FILE: node_modules/mixed-barrel/by-star.js
console.log("by-star.js is evaluated");
export function byStar() { return "by star"; }
export function inBoth() { return "the star's"; }

// FILE: node_modules/mixed-barrel/clause-wins.js
console.log("clause-wins.js is evaluated");
export function inBoth() { return "the clause's"; }

// FILE: node_modules/mixed-barrel/common.cjs
exports.fromCommonJS = function () { return "from CommonJS"; };

// FILE: node_modules/mixed-barrel/data.json
{ "kind": "data" }

// FILE: node_modules/mixed-barrel/index.js
export { byName } from "./by-name.js";
export { unaskedName } from "./unasked-name.js";
export * from "./by-star.js";
export * from "./inner/index.js";
export { fromCommonJS } from "./common.cjs";
export { unaskedCommonJS } from "./unasked-common.cjs";
export { default as data } from "./data.json";
export { default as unaskedData } from "./unasked-data.json";
export { inBoth } from "./clause-wins.js";

// FILE: node_modules/mixed-barrel/inner/asked.js
console.log("inner/asked.js is evaluated");
export function byInnerStar() { return "by the star of an inner barrel"; }

// FILE: node_modules/mixed-barrel/inner/index.js
export { byInnerStar } from "./asked.js";
export { unaskedInner } from "./unasked.js";

// FILE: node_modules/mixed-barrel/inner/unasked.js
console.log("inner/unasked.js is evaluated");
export function unaskedInner() {}

// FILE: node_modules/mixed-barrel/package.json
{ "name": "mixed-barrel", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }

// FILE: node_modules/mixed-barrel/unasked-common.cjs
console.log("unasked-common.cjs is evaluated");
exports.unaskedCommonJS = function () {};

// FILE: node_modules/mixed-barrel/unasked-data.json
{ "kind": "unasked" }

// FILE: node_modules/mixed-barrel/unasked-name.js
console.log("unasked-name.js is evaluated");
export function unaskedName() {}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
