// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.js
// The text of a direct eval stores to `exports`, `module`, `require`, `__filename`, `__dirname` and, in sloppy code, to `arguments`: code after the eval, inner functions and later evals read the stored value. Plain Bun takes arguments.cjs, whose own code names none of the five, for an ES module, which is strict, and has no fixed order for imported CommonJS files, so the output is stored: the files in import order.
import "./exports.cjs";
import "./module.cjs";
import "./paths.cjs";
import "./arguments.cjs";

// FILE: arguments.cjs
function stored() { eval("arguments = 1"); return arguments; }
console.log("arguments after eval:", stored(5, 6));
function storedThroughArrow() { (() => eval("arguments = 'arrow'"))(); return arguments; }
console.log("arguments stored through an arrow:", storedThroughArrow(5));
function readByFunction() { var read = () => arguments; eval("arguments = 'seen'"); return read(); }
console.log("arguments read by an arrow:", readByFunction(5));
class Strict { static store() { try { eval("arguments = 1"); } catch (e) { return e.name + ", " + arguments.length; } return arguments; } }
console.log("strict code rejects the text:", Strict.store(5, 6));

// FILE: exports.cjs
eval("exports = module.exports = { a: 1 }");
exports.b = 2;
console.log("module.exports.b:", module.exports.b, JSON.stringify(module.exports));
function readExports() { return exports; }
console.log("a function reads the stored object:", readExports() === module.exports);
(function () { eval("exports = 'stored in a function'"); })();
console.log("stored by an eval in a function:", exports, readExports(), typeof module.exports);
console.log("read by a later eval:", eval("exports"));

// FILE: module.cjs
var original = module;
eval("module = { exports: 'replaced' }");
console.log("module after eval:", JSON.stringify(module), module === original);
for (var i = 0; i < 2; i++) { console.log("module at the start of iteration " + i + ":", JSON.stringify(module)); eval("module = i"); }
console.log("module after the loop:", module, typeof original.exports);
var load = require;
eval("require = 'no function'");
console.log("require after eval:", require, typeof load);

// FILE: paths.cjs
console.log("paths at the start:", typeof __filename, typeof __dirname, __filename.startsWith(__dirname));
eval("__filename = 'file'; __dirname = 'directory'");
console.log("paths after eval:", __filename, __dirname);
var read = () => [__filename, __dirname].join();
eval("__dirname += '!'");
console.log("paths read by an arrow:", read());

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
