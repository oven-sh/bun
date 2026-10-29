// RUN: lower
// CHECK-LABEL: function {{*}}name="computed"
// CHECK-NOT: = Data
// CHECK: = NewArray
// CHECK-NOT: = Data
// CHECK-LABEL: function {{*}}name="list"
// CHECK-NOT: = NewArray
// CHECK: = Data data=d
// CHECK-NOT: = NewArray
// CHECK-LABEL: function {{*}}name="record"
// CHECK-NOT: = NewObject
// CHECK: = Data data=d
// CHECK-NOT: = NewObject

export function computed(f: any) {
  return [f()];
}

export function list() {
  return [1, 2, 3];
}

export function record() {
  return { a: 1 };
}
