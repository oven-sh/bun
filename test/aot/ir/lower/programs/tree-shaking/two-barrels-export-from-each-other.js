// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 6

// FILE: main.js
// "sideEffects": false. Each of two barrels exports one name of its own files and passes on the other's. The program asks the left one for a name that the right one holds, and the right one for a name that the left one holds. Every file prints when it is evaluated. `bun build --compile` leaves out the two files that nothing asks for.
import { fromRight } from "two-barrels/left.js";
import { fromLeft } from "two-barrels/right.js";

console.log(fromRight(), fromLeft());

// FILE: node_modules/two-barrels/left-file.js
console.log("left-file.js is evaluated");
export function fromLeft() { return "from left"; }

// FILE: node_modules/two-barrels/left-unused.js
console.log("left-unused.js is evaluated");
export function unusedLeft() { return "unused"; }

// FILE: node_modules/two-barrels/left.js
export { fromLeft } from "./left-file.js";
export { unusedLeft } from "./left-unused.js";
export { fromRight, unusedRight } from "./right.js";

// FILE: node_modules/two-barrels/package.json
{ "name": "two-barrels", "version": "1.0.0", "type": "module", "sideEffects": false }

// FILE: node_modules/two-barrels/right-file.js
console.log("right-file.js is evaluated");
export function fromRight() { return "from right"; }

// FILE: node_modules/two-barrels/right-unused.js
console.log("right-unused.js is evaluated");
export function unusedRight() { return "unused"; }

// FILE: node_modules/two-barrels/right.js
export { fromRight } from "./right-file.js";
export { unusedRight } from "./right-unused.js";
export { fromLeft } from "./left.js";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
