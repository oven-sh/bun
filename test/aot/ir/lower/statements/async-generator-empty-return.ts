// RUN: lower
// CHECK-LABEL: function {{*}}name="emptyReturn"
// CHECK-NOT: = Await
// CHECK: Return
// CHECK-NOT: = Await
// CHECK-LABEL: function {{*}}name="endOfBody"
// CHECK-NOT: = Await
// CHECK: Return
// CHECK-NOT: = Await
// CHECK-LABEL: function {{*}}name="returnValue"
// CHECK: [[awaited]] = Await
// CHECK: Return [[awaited]]

export async function* emptyReturn() {
  return;
}

export async function* endOfBody() {}

export async function* returnValue() {
  return 1;
}
