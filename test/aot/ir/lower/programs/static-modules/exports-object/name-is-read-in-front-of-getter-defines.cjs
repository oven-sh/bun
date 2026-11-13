// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// A getter that hands on a name of another module is there from its definition on: the module's own body, and a function that it calls, find nothing under the name in front of that.
console.log(require("./a.cjs").x);
console.log(require("./b.cjs").x);

// FILE: a.cjs
const m = require("./m.cjs");
console.log(exports.x);
Object.defineProperty(exports, "x", { enumerable: true, get() { return m.x; } });
console.log(exports.x);

// FILE: b.cjs
const m = require("./m.cjs");
console.log(early());
Object.defineProperty(exports, "x", { enumerable: true, get() { return m.x; } });
console.log(early());
function early() {
  return exports.x;
}

// FILE: m.cjs
exports.x = 7;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
