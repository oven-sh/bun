// RUN: lower
// OPTIONS: builtin-modules

// FILE: variables-named-like-five-names-output.js
// @bun
// Variables named like the five names of commonjs in the output of bun build.
var require = 1, module = 2, exports = 3, __filename = 4, __dirname = 5;
console.log(require, module, exports, __filename, __dirname, this);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=3
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v7 = Integer integer=4
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v9 = Integer integer=5
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v17 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v18 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v19 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v20 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: v22 = Call v15, v13, v16, v17, v18, v19, v20, v21 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
