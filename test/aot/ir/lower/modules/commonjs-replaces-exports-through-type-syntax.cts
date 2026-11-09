// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK: [[first]] = FinishObject
// CHECK-NEXT: PutModuleVariable [[first]] variable=[[exports]]
// CHECK-NEXT: PutModuleVariable [[first]] variable=[[held]]
// CHECK-NEXT: [[early]] = GetModuleVariable variable=[[held]]
// CHECK: PropSet [[early]], {{*}}key="z"
// CHECK: PutModuleVariable {{*}}variable=[[exports]]
// CHECK-NEXT: [[late]] = GetModuleVariable variable=[[held]]
// CHECK: PropSet [[late]], {{*}}key="b"

// A store through a type assertion is a store: `module.exports` comes to hold another value, and `exports` goes on naming the object that the body began with, which has a variable of its own.
// @ts-nocheck
exports.z = 0;
(module.exports as any) = { a: 1 };
exports.b = 2;
