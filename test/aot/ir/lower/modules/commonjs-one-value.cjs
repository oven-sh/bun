// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK-NEXT: b0():
// CHECK-NOT: = NewObject
// CHECK: PutModuleVariable {{*}}variable=g
// CHECK-NOT: = NewObject
// CHECK: Return

// `module.exports = f` as the first mention of the exports allocates nothing.
module.exports = f;
function f() {}
