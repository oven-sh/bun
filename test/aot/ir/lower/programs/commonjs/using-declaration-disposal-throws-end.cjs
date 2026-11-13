// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// A using declaration whose disposal throws at the end of the body.
let m;
try { m = require("./m.cjs"); } catch (e) { console.log("caught", e.message); }
console.log(typeof m);
try { m = require("./m.cjs"); console.log("second", m.a, m.b); } catch (e) { console.log("caught again", e.message); }

// FILE: m.cjs
using r = { [Symbol.dispose]() { throw new Error("dispose"); } };
exports.a = 1;
exports.b = require("./x.cjs").v;

// FILE: x.cjs
console.log("x runs"); exports.v = "x";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
