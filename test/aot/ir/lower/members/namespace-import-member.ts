// RUN: lower
// CHECK-LABEL: function {{*}}name="call"
// CHECK-NOT: PropGet
// CHECK: = GetModuleVariable
// CHECK-NOT: PropGet
// CHECK: = ModuleNamespace module=m
// CHECK-NOT: PropGet
// CHECK: = Call [[function]], [[namespace]] calleeName="ns.f"
// CHECK-LABEL: function {{*}}name="computed"
// CHECK-NOT: GetModuleVariable
// CHECK: = ModuleNamespace module=m
// CHECK: = ElemGet
// CHECK-LABEL: function {{*}}name="read"
// CHECK-NOT: ModuleNamespace
// CHECK-NOT: PropGet
// CHECK: = GetModuleVariable
// CHECK-NOT: ModuleNamespace
// CHECK-NOT: PropGet
// CHECK: Return

import * as ns from "./imports/values";

export function call() {
  return ns.f();
}

export function computed(k: keyof typeof ns) {
  return ns[k];
}

export function read() {
  return ns.a;
}
