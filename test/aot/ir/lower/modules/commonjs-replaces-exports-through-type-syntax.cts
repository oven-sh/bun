// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK: [[first]] = FinishObject
// CHECK-NEXT: PutModuleVariable [[first]] variable=[[exports]]
// CHECK: PropSet [[first]], {{*}}key="z"
// CHECK: PutModuleVariable {{*}}variable=[[exports]]
// CHECK: PropSet [[first]], {{*}}key="b"

// RUN(LOCAL): lower
// LOCAL-NOT: GetModuleVariable

// A store through a type assertion is a store: `module.exports` comes to hold another value, and `exports` goes on naming the object that the body began with, as a binding of the body: no variable of the module holds it.
// @ts-nocheck
exports.z = 0;
(module.exports as any) = { a: 1 };
exports.b = 2;
