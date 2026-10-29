// RUN: lower
// OPTIONS: builtin-modules
// ENTRY: main.js with-attribute.cjs without-attribute.cjs
// STATISTIC: SourceFilesInferred = 3
// STATISTIC: SourceFilesData = 2

// FILE: main.js
// require(path, { type }) with a computed path asks for the file, not for the compiled module at that path, so the module does not run. Without the attribute the same kind of path runs the compiled module.
// `bun run` answers the text of the file. An executable does not hold that text, and the call throws.
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

// GENERATED: compileBoth computed
// CHECK-LABEL: function {{*}}name="compileBoth"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v1 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="./"
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
