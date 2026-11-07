// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK: [[first]] = FinishObject
// CHECK-NEXT: PutModuleVariable [[first]] variable=[[exports]]
// CHECK-NEXT: PutModuleVariable [[first]] variable=[[held]]
// CHECK-NEXT: [[early]] = GetModuleVariable variable=[[held]]
// CHECK: PropSet [[early]], {{*}}key="z"
// CHECK: [[rest]] = NewArray
// CHECK: PutModuleVariable [[rest]] variable=[[exports]]
// CHECK: [[late]] = GetModuleVariable variable=[[held]]
// CHECK: PropSet [[late]], {{*}}key="b"

// A rest element is stored to like any other part of a pattern: `exports` goes on naming the object that the body began with.
exports.z = 0;
[...module.exports] = [1];
exports.b = 2;
