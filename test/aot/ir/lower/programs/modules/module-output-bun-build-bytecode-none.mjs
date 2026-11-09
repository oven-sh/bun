// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="attempt"

// FILE: module-output-bun-build-bytecode-none.mjs
// @bun @bytecode
// The first line is the one that `bun build --target=bun --bytecode` writes, and no bytecode lies beside the file.
function attempt(what, run) {
  try {
    console.log(what, run());
  } catch (error) {
    console.log(what, error.name + ": " + error.message);
  }
}
console.log(typeof require, typeof module, typeof exports, typeof __filename, typeof __dirname);
console.log(this === undefined ? "no this" : typeof this);
attempt("this of a plain call", () => (function () { return typeof this; })());
attempt("a store to a name that nothing declares", () => { nothingDeclaresThis = 1; return delete globalThis.nothingDeclaresThis; });
attempt("require", () => typeof require("node:path").join);
attempt("require.resolve", () => typeof require.resolve);
attempt("module", () => typeof module.exports);
attempt("exports", () => Object.keys(exports).join());
attempt("__filename", () => typeof __filename.length);
attempt("__dirname", () => typeof __dirname.length);
attempt("a store to a member of exports", () => { exports.stored = 1; return "stored"; });
attempt("a store to module", () => { module = 1; return "stored"; });
attempt("a store to exports", () => { exports = 1; return "stored"; });
attempt("a store to require", () => { require = 1; return "stored"; });
attempt("a store to __filename", () => { __filename = 1; return "stored"; });
attempt("a store to __dirname", () => { __dirname = 1; return "stored"; });
console.log(typeof require !== "undefined" && typeof module !== "undefined" ? "takes itself for CommonJS" : "takes itself for an ES module");
attempt("import.meta.require", () => typeof import.meta.require("node:path").join);
attempt("import.meta.main", () => typeof import.meta.main);
export {};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
