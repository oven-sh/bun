// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS100150 1
// STATISTIC: SourceFilesInferred = 8
// CHECK-LABEL: function {{*}}name="lastParts"

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
