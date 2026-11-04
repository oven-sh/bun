// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.js
// A wrapper is called while the `var` of the wrapper that it calls is still undefined: a TypeError. The callback that threw is not run again, and the next call answers its exports as far as they had got.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_a = __commonJS((exports) => {
  exports.fromB = require_b().n;
});
var outcome;
try {
  require_a();
} catch (error) {
  outcome = error.constructor.name;
}
var require_b = __commonJS((exports) => {
  exports.n = 1;
});
console.log(outcome, require_a().fromB, require_b().n);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: __commonJS
// CHECK-LABEL: function {{*}}name="__commonJS"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=undefined|null|[[f_2]] flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v3 = NewClosure v2, v0 function=[[f_5]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
