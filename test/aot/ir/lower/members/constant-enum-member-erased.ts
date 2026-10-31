// RUN: lower
// OPTIONS: erase-types
// CHECK-LABEL: function {{*}}name="bracket"
// CHECK-NOT: PropGet
// CHECK: = Integer integer=7 @
// CHECK-NOT: PropGet
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: = ElemGet
// CHECK-LABEL: function {{*}}name="constEnum"
// CHECK-NOT: PropGet
// CHECK: = Integer integer=1 @
// CHECK-NOT: PropGet
// CHECK-LABEL: function {{*}}name="numberMember"
// CHECK-NOT: PropGet
// CHECK: = Integer integer=7 @
// CHECK-NOT: PropGet
// CHECK-LABEL: function {{*}}name="stringMember"
// CHECK-NOT: PropGet
// CHECK: = String string="b"
// CHECK-NOT: PropGet

enum E {
  A = 7,
  B = "b",
}

const enum C {
  A = 1,
}

export function bracket() {
  return E["A"];
}

export function computed(k: number) {
  return E[k];
}

export function constEnum() {
  return C.A;
}

export function numberMember() {
  return E.A;
}

export function stringMember() {
  return E.B;
}
