// RUN: lower
// OPTIONS: builtin-modules
// CHECK-LABEL: function {{*}}name="r"
// CHECK-LABEL: function {{*}}name="d"

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
