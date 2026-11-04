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
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Integer integer=3
// CHECK-NEXT: v4 = Integer integer=4
// CHECK-NEXT: v5 = Integer integer=5
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = Null
// CHECK-NEXT: v12 = Call v10, v8, v1, v2, v3, v4, v5, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
