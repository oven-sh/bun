// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK-NEXT: b0():
// CHECK: CallDirect {{*}}function=
// CHECK: Return

// RUN(WRAPPED): lower
// WRAPPED: ([[this]]: anything, [[exports]]: anything,
// WRAPPED-NOT: = Undefined
// WRAPPED: PropSet {{*}}key="a"

// `var exports;` declares a parameter again and stores nothing. That can only be said of a function that has the five names as parameters, so the text of the file stays one, and the body of the module calls it.
var exports;
exports.a = 1;
