// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// Sloppy functions that assign to `arguments`: the variable changes, and the object that mapped parameters live in stays. Stores in branches, loops, `try`, arrows and direct eval. Plain Bun's transpiler rejects a store to `arguments` in sloppy code too, so the expected output follows ECMAScript.
import * as sloppy from "./sloppy.cjs";
for (const name of Object.keys(sloppy).sort()) {
  const f = sloppy[name];
  if (typeof f !== "function") continue;
  for (const list of [[], [1], [1, 2], ["a", { b: 1 }, [3]], [undefined, null]]) {
    let shown;
    try { shown = JSON.stringify(f(...list)) ?? "undefined"; } catch (e) { shown = "threw " + e.name + ": " + e.message; }
    console.log(name + "(" + JSON.stringify(list).slice(1, -1) + "): " + shown);
  }
}

// FILE: sloppy.cjs
function show(value) { return Object.prototype.toString.call(value) === "[object Arguments]" ? ["arguments object"].concat(Array.prototype.slice.call(value)) : value; }
exports.storeKeepsParameter = function (a) { arguments = [a]; return a; };
exports.storedValueIsRead = function (a) { arguments = [a]; return arguments; };
exports.objectOutlivesStore = function (x) { var a = arguments; arguments = 1; a[0] = 5; return x; };
exports.parameterStoreReachesObject = function (x) { var a = arguments; arguments = 1; x = "stored"; return [show(a), arguments]; };
exports.storedOnOneBranch = function (c) { if (c) arguments = 1; return show(arguments); };
exports.returnedFromLoop = function () { for (var i = 0; i < 2; i++) { if (i === 1) return arguments; arguments = 7; } };
exports.readAfterLoop = function () { var i = 0; while (i < 3) { arguments = i; i++; } return arguments; };
exports.readBeforeStoreInLoop = function () { var seen = []; for (var i = 0; i < 3; i++) { seen.push(show(arguments)); arguments = i; } return seen; };
exports.storedInInnerLoop = function () { var seen = []; for (var i = 0; i < 2; i++) { seen.push(show(arguments)); for (var j = 0; j < 2; j++) arguments = i + "," + j; } return seen; };
exports.forOfTarget = function () { for (arguments of [1, 2]); return arguments; };
exports.forInTarget = function () { for (arguments in { key: 1 }); return arguments; };
exports.storedInTry = function () { try { arguments = "try"; throw 1; } catch (e) { return arguments; } };
exports.storedInFinally = function () { try { return show(arguments); } finally { arguments = "finally"; } };
exports.compoundStore = function () { arguments += "!"; return arguments; };
exports.incremented = function () { arguments++; return String(arguments); };
exports.destructured = function (a) { [arguments] = [[a]]; return [arguments, a]; };
exports.declaredWithoutInitializer = function () { var arguments; return show(arguments); };
exports.declaredWithInitializer = function (a) { var arguments = [a, a]; return arguments; };
exports.storedByArrow = function (a) { (() => { arguments = "arrow"; })(); return [arguments, a]; };
exports.readByArrowAfterStore = function () { arguments = "outer"; return (() => arguments)(); };
exports.mappedAfterArrowStore = function (a) { var object = arguments; (() => { arguments = "arrow"; })(); object[0] = "mapped"; return [arguments, a]; };
exports.readByEval = function () { arguments = 1; return eval("arguments"); };
exports.storedByEval = function () { eval("arguments = 5"); return arguments; };
exports.mappedAfterEvalStore = function (a) { var object = arguments; eval("arguments = 5"); object[0] = "mapped"; return [arguments, a]; };
exports.storedByEvalInLoop = function () { var seen = []; for (var i = 0; i < 2; i++) { seen.push(show(arguments)); eval("arguments = i"); } return seen; };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
