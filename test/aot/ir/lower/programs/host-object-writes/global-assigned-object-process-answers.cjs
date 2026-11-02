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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v2 = NewObject layout=[[L_1]]
// CHECK-NEXT: PropDefine v2, v1 key="createRequire"
// CHECK-NEXT: v4 = FinishObject v2
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
