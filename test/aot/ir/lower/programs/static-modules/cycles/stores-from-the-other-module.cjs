// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// While a runs, b stores to names of a: one that a has stored, one that a adds to afterwards, and one that a stores only later. a reads what b stored, and its own later store wins. All by names.
const a = require("./a.cjs");
console.log(a.afterB, require("./b.cjs").read());

// FILE: a.cjs
exports.count = 1;
exports.replaced = "by a";
const b = require("./b.cjs");
exports.count++;
exports.afterB = [exports.count, exports.replaced, exports.planted].join();
exports.planted = "by a";

// FILE: b.cjs
const a = require("./a.cjs");
a.count += 10;
a.replaced = "by b";
a.planted = "by b";
exports.read = () => [a.count, a.replaced, a.planted].join();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
