// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 7

// FILE: main.js
// Which file is the barrel is for package.json to say: an "exports" map with conditions, "browser" beside "main", an "exports" map with a subpath that is a barrel too. Each package has a barrel that must be picked and one that must not, and each barrel has a file nobody asks for.
import { picked as byExports } from "by-exports";
import { picked as byBrowser } from "by-browser";
import { picked as bySubpath } from "by-exports/sub";

console.log(byExports(), byBrowser(), bySubpath());

// FILE: node_modules/by-browser/browser-impl.js
export function picked() { return "by-browser: browser"; }

// FILE: node_modules/by-browser/browser.js
export { picked } from "./browser-impl.js";

// FILE: node_modules/by-browser/impl.js
export function picked() { return "by-browser: main"; }

// FILE: node_modules/by-browser/main.js
export { picked } from "./impl.js";
export { unasked } from "./unasked.js";

// FILE: node_modules/by-browser/package.json
{ "name": "by-browser", "version": "1.0.0", "type": "module", "sideEffects": false, "main": "./main.js", "browser": "./browser.js" }

// FILE: node_modules/by-browser/unasked.js
console.log("by-browser/unasked.js is evaluated");
export function unasked() {}

// FILE: node_modules/by-exports/impl.js
export function picked() { return "by-exports: the bun condition"; }

// FILE: node_modules/by-exports/package.json
{
  "name": "by-exports",
  "version": "1.0.0",
  "type": "module",
  "sideEffects": false,
  "main": "./wrong.js",
  "exports": {
    ".": { "browser": "./wrong.js", "bun": "./right.js", "default": "./wrong.js" },
    "./sub": { "import": "./sub/right.js", "require": "./wrong.js" }
  }
}

// FILE: node_modules/by-exports/right.js
export { picked } from "./impl.js";
export { unasked } from "./unasked.js";

// FILE: node_modules/by-exports/sub/impl.js
export function picked() { return "by-exports/sub: the import condition"; }

// FILE: node_modules/by-exports/sub/right.js
export { picked } from "./impl.js";
export { unasked } from "../unasked.js";

// FILE: node_modules/by-exports/unasked.js
console.log("by-exports/unasked.js is evaluated");
export function unasked() {}

// FILE: node_modules/by-exports/wrong-impl.js
export function picked() { return "by-exports: the wrong file"; }

// FILE: node_modules/by-exports/wrong.js
export { picked } from "./wrong-impl.js";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
