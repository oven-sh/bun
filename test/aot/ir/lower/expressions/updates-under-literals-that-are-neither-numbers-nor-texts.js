// RUN: lower
// The object of such an update is tested ahead of the read, and the read stands for the test.
// CHECK-LABEL: function {{*}}name="compound"
// CHECK: = ElemGet {{*}} callers
// CHECK-LABEL: function {{*}}name="logical"
// CHECK: = ElemGet {{*}} callers
// CHECK-LABEL: function {{*}}name="update"
// CHECK: = ElemGet {{*}} callers
// CHECK: = ElemGet {{*}} callers

export function compound(a) {
  a[null] += 1;
}

export function logical(a) {
  a[undefined] ??= 1;
}

export function update(a) {
  a[true]++;
  --a[false];
}
