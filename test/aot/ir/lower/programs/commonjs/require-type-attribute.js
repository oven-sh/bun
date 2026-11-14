// RUN: lower
// OPTIONS: builtin-modules
// ENTRY: main.js with-attribute.cjs without-attribute.cjs
// STATISTIC: SourceFilesInferred = 3
// STATISTIC: SourceFilesData = 1
// CHECK-LABEL: function {{*}}name="compileBoth"
// CHECK-LABEL: function {{*}}name="computed"

// FILE: main.js
// require(path, { type }) with a computed path asks for the file, not for the compiled module at that path, so the module does not run. Without the attribute the same kind of path runs the compiled module.
// It answers the text of the file, under `bun run` and in an executable: every name that the path can take is known, and the type is written in place.
globalThis.evaluated = [];

const computed = name => "./" + name;

function compileBoth() {
  require("./with-attribute.cjs");
  require("./without-attribute.cjs");
}

const exported = require(computed("without-attribute.cjs"));
console.log("without an attribute:", typeof exported, exported.name, "evaluated:", globalThis.evaluated.join());

try {
  require(computed("with-attribute.cjs"), { type: "text" });
} catch {}
console.log("with an attribute: evaluated:", globalThis.evaluated.join());
console.log(typeof compileBoth);

// FILE: with-attribute.cjs
globalThis.evaluated.push("with-attribute");
exports.name = "with-attribute";

// FILE: without-attribute.cjs
globalThis.evaluated.push("without-attribute");
exports.name = "without-attribute";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
