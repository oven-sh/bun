// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS100151 1

// FILE: main.mjs
// The entry point imports the module that imports what is not installed, so plain Bun fails before the first line runs and the build stops.
// Two more modules reach that module too, and only late sites load them.
import "./broken.mjs";
console.log("the entry runs");
import("./late.mjs").catch(error => console.log(error.message));
try {
  require("./above-late.mjs");
} catch (error) {
  console.log(error.message);
}

// FILE: above-late.mjs
import { late } from "./late.mjs";
export const aboveLate = late + 1;

// FILE: broken.mjs
import "not-installed";
export const broken = 1;

// FILE: late.mjs
import { broken } from "./broken.mjs";
export const late = broken + 1;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
