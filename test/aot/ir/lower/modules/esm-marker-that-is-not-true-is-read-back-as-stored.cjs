// RUN: link
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK: PropSet {{*}}key="__esModule"
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK-NOT: __esModule
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK: [[stored]] = PropGet {{*}}key="__esModule"
// CHECK-NEXT: [[known]] = Boolean boolean=true
// CHECK-NEXT: = Call {{*}}, [[stored]], [[known]] calleeKey="log"

// FILE: main.cjs
const one = require("./one.cjs");
const yes = require("./yes.cjs");
console.log(one.__esModule, yes.__esModule);

// FILE: one.cjs
exports.__esModule = 1;

// FILE: yes.cjs
exports.__esModule = true;
