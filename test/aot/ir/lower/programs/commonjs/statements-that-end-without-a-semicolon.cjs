// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.cjs
// Statements that end without a semicolon.
var a = 1
var b = a
++a
console.log(a, b)
var c = "x"
;[1].forEach(function (n) { c += n })
var d = function () { return 1 }
;(function () { c += "!" })()
console.log(c, d())
function r() { return
  5 }
console.log(r())
var s = 'line \
continued'; console.log(s)
console.log(" ".length, eval("' '").length, `a
b`.length)

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: r d
// CHECK-LABEL: function {{*}}name="r"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="d"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
