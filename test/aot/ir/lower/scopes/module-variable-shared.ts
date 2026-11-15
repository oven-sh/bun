// RUN: lower
// CHECK-LABEL: function {{*}}name="inc"
// CHECK-NOT: captures=
// CHECK: = GetModuleVariable variable=[[n]]
// CHECK: PutModuleVariable {{*}}variable=[[n]]

let n = 0;

export function inc() {
  n++;
}
