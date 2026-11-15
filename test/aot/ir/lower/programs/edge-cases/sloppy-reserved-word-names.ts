// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// A sloppy file names variables `package`, `interface` and `static`, deletes a name and reads `arguments.callee`.
// @ts-ignore
import old from "./old.js";
console.log(old.sum, old.gone, old.callee, old.octal);

// FILE: old.js
var package = 1, interface = 2, static = 3;
var x = 5;
var gone = delete x;
function f(a, a2) { return arguments.callee === f }
module.exports = { sum: package + interface + static, gone: gone, callee: f(1, 2), octal: 010 };

// FILE: tsconfig.json
{ "compilerOptions": { "strict": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "noEmit": true, "types": [], "lib": ["esnext", "dom"] }, "include": ["main.ts"] }
