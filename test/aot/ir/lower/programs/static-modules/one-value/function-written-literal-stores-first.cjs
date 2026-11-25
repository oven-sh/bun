// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// A store that runs before `module.exports = { .. }` lands on the first object.
const m = require("./module.cjs");
console.log(Object.keys(m).join(), m.a, m.early, m.late);
const below = require("./below.cjs");
console.log(below.a, below.b, below.c, below.read());

// FILE: below.cjs
const early = [set("early"), read()].join("|");
module.exports = { a: 2, read };
module.exports.c = early;
function set(name) { module.exports.b = name; return module.exports.b; }
function read() { return [module.exports.a, module.exports.b].join(); }

// FILE: module.cjs
function set(name) { module.exports[name === "early" ? "early" : "late"] = name; module.exports.a = name; }
set("early");
module.exports = { a: 2 };
set("late");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
