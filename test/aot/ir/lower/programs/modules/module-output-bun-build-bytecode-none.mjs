// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: attempt
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1 calleeName="run"
// CHECK-NEXT: v8 = Call v6, v4, v0, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v9 key="name"
// CHECK-NEXT: v16 = String string=": "
// CHECK-NEXT: v17 = Add v15, v16
// CHECK-NEXT: v18 = PropGet v9 key="message"
// CHECK-NEXT: v19 = Add v17, v18
// CHECK-NEXT: v20 = Call v14, v12, v0, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
