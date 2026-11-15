// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 8

// FILE: main.js
// "sideEffects" holds two globs: "./polyfills/*.js" and "**/*.setup.js". index.js imports five files for their effects; three match. `bun run` reports all five. `bun build --compile` reports polyfills/one.js, three.setup.js and lib/four.setup.js, and --aot follows it.
import { report } from "globbed";

console.log(report());

// FILE: node_modules/globbed/five.js
import { seen } from "./seen.js";
seen.push("five.js");

// FILE: node_modules/globbed/index.js
import "./polyfills/one.js";
import "./polyfills/nested/two.js";
import "./three.setup.js";
import "./lib/four.setup.js";
import "./five.js";
import { seen } from "./seen.js";
export function report() { return seen.join(", ") || "nothing"; }

// FILE: node_modules/globbed/lib/four.setup.js
import { seen } from "../seen.js";
seen.push("lib/four.setup.js");

// FILE: node_modules/globbed/package.json
{ "name": "globbed", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": ["./polyfills/*.js", "**/*.setup.js"] }

// FILE: node_modules/globbed/polyfills/nested/two.js
import { seen } from "../../seen.js";
seen.push("polyfills/nested/two.js");

// FILE: node_modules/globbed/polyfills/one.js
import { seen } from "../seen.js";
seen.push("polyfills/one.js");

// FILE: node_modules/globbed/seen.js
export const seen = [];

// FILE: node_modules/globbed/three.setup.js
import { seen } from "./seen.js";
seen.push("three.setup.js");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
