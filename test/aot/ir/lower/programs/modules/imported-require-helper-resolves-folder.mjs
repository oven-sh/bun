// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS100150 1
// STATISTIC: SourceFilesInferred = 8

// FILE: main.mjs
// A `require` that another file exports resolves paths from that file's folder, not from the folder of the file that calls it.
import { __require as first } from "./first/chunk.mjs";
import { __require as second } from "./second/chunk.mjs";
const lastParts = (path, count) => path.split(/[\\/]/).slice(-count).join("/");
console.log(first("./inside.cjs"), "|", second("./inside.cjs"), "|", require("./inside.cjs"));
console.log(lastParts(first.resolve("./inside.cjs"), 2), lastParts(second.resolve("./inside.cjs"), 2));
for (const name of ["a", "b"]) console.log(first("./parts/" + name + ".cjs"));
for (const name of ["./missing.cjs", "./parts/" + process.argv.length + ".cjs", "missing-package"]) {
  try {
    first(name);
  } catch (error) {
    const lines = error.message.split("\n");
    console.log(error.code, lines[0], lastParts(lines.at(-1), 2));
  }
}
try {
  second("./missing.cjs");
} catch (error) {
  console.log(error.code, lastParts(error.message.split("\n").at(-1), 2));
}

// FILE: first/chunk.mjs
export var __require = /* @__PURE__ */ (x =>
  typeof require !== "undefined"
    ? require
    : typeof Proxy !== "undefined"
      ? new Proxy(x, {
          get: (a, b) => (typeof require !== "undefined" ? require : a)[b],
        })
      : x)(function (x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// FILE: first/inside.cjs
module.exports = "beside the first chunk";

// FILE: first/parts/a.cjs
module.exports = "part a";

// FILE: first/parts/b.cjs
module.exports = "part b";

// FILE: inside.cjs
module.exports = "beside the entry point";

// FILE: second/chunk.mjs
export var __require = /* @__PURE__ */ (x =>
  typeof require !== "undefined"
    ? require
    : typeof Proxy !== "undefined"
      ? new Proxy(x, {
          get: (a, b) => (typeof require !== "undefined" ? require : a)[b],
        })
      : x)(function (x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// FILE: second/inside.cjs
module.exports = "beside the second chunk";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: lastParts
// CHECK-LABEL: function {{*}}name="lastParts"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="split"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v4 = NewRegExp pattern="[\\\\/]"
// CHECK-NEXT: v5 = Call v3, v0, v4 calleeKey="split" calleeName="path.split"
// CHECK-NEXT: v6 = PropGet v5 key="slice"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v8 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v9 = Negate v8
// CHECK-NEXT: v10 = Call v7, v5, v9 calleeKey="slice" calleeName="slice"
// CHECK-NEXT: v11 = PropGet v10 key="join"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v13 = String string="/"
// CHECK-NEXT: v14 = Call v12, v10, v13 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v14
// CHECK-NEXT: }
