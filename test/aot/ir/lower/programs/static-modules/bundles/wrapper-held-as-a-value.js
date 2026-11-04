// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.js
// A wrapper that is also held as a value, put into an array and called with an argument.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_a = __commonJS((exports) => {
  exports.n = 1;
});
var held = require_a;
console.log(held().n, [require_a].map(wrapper => wrapper().n).join(), require_a(1).n, require_a() === held());

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: __commonJS
// CHECK-LABEL: function {{*}}name="__commonJS"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v3 = NewClosure v2, v0 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
