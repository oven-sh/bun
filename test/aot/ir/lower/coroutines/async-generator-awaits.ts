// RUN: lower
// CHECK-LABEL: function {{*}}name="reachEnd"
// CHECK-NOT: = Await
// CHECK-LABEL: function {{*}}name="returnFromAsyncFunction"
// CHECK-NOT: = Await
// CHECK-LABEL: function {{*}}name="returnNothing"
// CHECK-NOT: = Await
// CHECK-LABEL: function {{*}}name="returnValue"
// CHECK: = Await
// CHECK-NOT: = Await
// CHECK: Return
// CHECK-NOT: = Await
// CHECK-LABEL: function {{*}}name="yieldValue"
// CHECK: [[awaited]] = Await
// CHECK-NEXT: [[request]] = Convert [[awaited]] declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: = Yield [[request]]
// CHECK-NOT: = Await

export async function* reachEnd() {}

export async function returnFromAsyncFunction(value: number) {
  return value;
}

export async function* returnNothing() {
  return;
}

export async function* returnValue(value: number) {
  return value;
}

export async function* yieldValue(value: Promise<number>) {
  yield value;
}
