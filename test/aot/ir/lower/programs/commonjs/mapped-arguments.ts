// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Sloppy functions whose parameters and `arguments[i]` are one variable: reads and stores of the parameters, through the object, from inner functions, in loops and across collections.
import * as sloppy from "./sloppy.cjs";
for (const name of Object.keys(sloppy).sort()) {
  const f = (sloppy as any)[name];
  if (typeof f !== "function") continue;
  for (const list of [[], [1], [1, 2], [1, 2, 3], ["a", { b: 1 }, [3], 4], [undefined, null]]) {
    let shown: string;
    try { shown = JSON.stringify(f(...list)) ?? "undefined"; } catch (e: any) { shown = "threw " + e.name + ": " + e.message; }
    console.log(name + "(" + JSON.stringify(list).slice(1, -1) + "): " + shown);
  }
}

// FILE: sloppy.cjs
function change(list, index, value) { list[index] = value; return list.length; }
function show(list) { return Array.prototype.map.call(list, x => x === undefined ? "undefined" : x); }
exports.readsAfterSlice = function (a, b) { var rest = Array.prototype.slice.call(arguments, 1); return [a, b, a, b, rest]; };
exports.keptInAVariable = function (a, b) { var args = arguments; return [a, b, args.length, show(args)]; };
exports.storeToAParameterIsSeenInTheObject = function (a, b) { var args = arguments; a = "stored"; b = "also"; return [a, b, show(args), args.length]; };
exports.storeToTheObjectIsSeenInAParameter = function (a, b) { arguments[0] = "zero"; arguments[1] = "one"; return [a, b, arguments.length]; };
exports.changedByAnotherFunction = function (a, b) { var before = [a, b]; change(arguments, 0, "changed"); change(arguments, 1, "too"); return [before, a, b]; };
exports.defaultByAStore = function (a, b) { if (arguments.length < 2) b = "default"; return [a, b, show(arguments)]; };
exports.orDefault = function (a, options) { options = options || {}; var args = arguments; return [a, options, show(args)]; };
exports.storedInALoop = function (a, b) { var args = arguments; for (var i = 0; i < 5; i++) { a = (a | 0) + i; args[1] = (b | 0) + a; } return [a, b, show(args)]; };
exports.readByAnInnerFunction = function (a, b) { var args = arguments; function inner() { return [a, b]; } args[0] = "late"; return [inner(), a]; };
exports.storedByAnInnerFunction = function (a, b) { var args = arguments; (function () { a = "inner"; })(); (() => { b = "arrow"; })(); return [a, b, show(args)]; };
exports.deletedThenStored = function (a, b) { delete arguments[0]; arguments[0] = "again"; a = a === undefined ? "was undefined" : a; return [a, b, show(arguments)]; };
exports.redefined = function (a, b) { Object.defineProperty(arguments, "0", { value: "fixed", writable: false }); a = "parameter"; return [a, arguments[0], b]; };
exports.calleeIsTheFunction = function named(a) { return [arguments.callee === named, a]; };
exports.objectsSurviveCollections = function (a, b) { var args = arguments; a = { fresh: [a] }; for (var i = 0; i < 20000; i++) b = { n: i, previous: null }; (globalThis.gc ?? (() => globalThis.Bun.gc(true)))(); return [a, b, show(args)]; };
exports.moreParametersThanArguments = function (a, b, c, d) { var args = arguments; c = "c"; d = "d"; return [a, b, c, d, args.length, show(args), args[2], args[3]]; };
exports.incremented = function (a, b) { var args = arguments; a++; --b; a += 2; return [a, b, show(args)]; };
exports.inTryAndFinally = function (a, b) { var args = arguments; try { a = "try"; throw 1; } catch (e) { b = "catch"; } finally { args[0] = args[0] + "!"; } return [a, b]; };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
