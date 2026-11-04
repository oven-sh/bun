// RUN: lower
// OPTIONS: builtin-modules
// ENTRY: main.js loaded-by-name.cjs
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// `import.meta.require` read as a value loads a compiled module by a name computed at run time, and an export that only such a load reads is there.
import "./loaded-by-name.cjs";

const load = import.meta.require;
const name = ["./loaded", "by", "name.cjs"].join("-");
console.log(typeof load, load === import.meta.require, load === import.meta["require"]);
console.log(load(name).readOnlyByName, load(name) === load(name));

function callThrough(loader, ...names) {
  return names.map(name => loader(name).readOnlyByName);
}
console.log(callThrough(import.meta.require, name, name).join());
console.log(import.meta.require(...[name]).readOnlyByName);

// FILE: loaded-by-name.cjs
exports.readOnlyByName = "read";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: callThrough
// CHECK-LABEL: function {{*}}name="callThrough"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=Array flags=[IsFromCompiler]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: Array):
// CHECK-NEXT: v2 = PropGet v1 key="map"
// CHECK-NEXT: v3 = NewClosure v0 function=[[f_1]]
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="map" calleeName="names.map"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
