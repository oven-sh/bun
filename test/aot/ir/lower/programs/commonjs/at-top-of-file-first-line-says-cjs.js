// RUN: lower
// OPTIONS: builtin-modules

// FILE: at-top-of-file-first-line-says-cjs.js
// @bun @bun-cjs
// This at the top of a file whose first line says commonjs.
(function (exports, require, module, __filename, __dirname) {
  console.log(
    this === exports,
    this === module.exports,
    this === module,
    this === globalThis,
    this === undefined,
    typeof this,
  );
  const arrow = () => this === module;
  console.log(
    arrow(),
    (function () {
      return this === globalThis;
    })(),
    eval("this === module"),
  );
  module.exports = { replaced: true };
  console.log(this === module.exports, this === module, this === exports);
});

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: arrow
// CHECK-LABEL: function {{*}}name="arrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=anything}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetMappedArgument v1 index=2
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v4 = StrictEq v0, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
