// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1

// FILE: main.cjs
// Global is assigned an object whose process answers for node module.
global = { process: { getBuiltinModule: () => ({ createRequire: () => name => console.log("mine", name) }) } }; global.process.getBuiltinModule("node:module").createRequire(__filename)("./next.cjs");

// FILE: next.cjs
console.log("the next file");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: getBuiltinModule
// CHECK-LABEL: function {{*}}name="getBuiltinModule"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = NewObject -, v0 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v2 = FinishObject v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
