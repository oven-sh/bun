// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2
// CHECK-LABEL: function {{*}}name="show"

// FILE: main.cjs
// A required module takes the module object of its parent and of the entry point and changes what they export.
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
exports.byParent = 1;
exports.byMain = 1;
exports.byProcess = 1;
exports.f = function (x) { return typeof x; };
const log = require("./child.cjs");
show("1", typeof exports.byParent, typeof exports.byMain, typeof exports.byProcess, log.join());

// FILE: child.cjs
const log = [];
const parent = module.parent; parent.exports.byParent = "s"; log.push(parent.exports.f(1));
const main = require.main; main.exports.byMain = "s"; log.push(main.exports.f("s"));
const fromProcess = process.mainModule; fromProcess.exports.byProcess = "s"; log.push(fromProcess.exports.f());
module.exports = log;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
