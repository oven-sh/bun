// RUN(EXPORTED): link
// EXPORTED: variable {{*}}name="a" {{*}}initialization=Function function=

// RUN(SHARED): link
// SHARED: variable {{*}}name="b" {{*}}initialization=Function function=

// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-NOT: NewClosure
// CHECK-NOT: PutModuleVariable
// CHECK-LABEL: function {{*}}name="a"
// CHECK-NOT: captures=
// CHECK: = GetModuleVariable

export function a() {
  return b();
}

function b() {}
