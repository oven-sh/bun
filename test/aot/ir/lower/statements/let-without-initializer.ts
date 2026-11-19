// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = Undefined
// CHECK: [[undefined]] = Undefined
// CHECK-NEXT: PutModuleVariable [[undefined]] variable=
// CHECK-NOT: PutModuleVariable

export let a: unknown;
export var b: unknown;
