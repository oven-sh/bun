// RUN: lower
// CHECK-LABEL: function {{*}}name="tick"
// CHECK: InitialYield
// CHECK-NEXT: [[undefined]] = Undefined
// CHECK-NEXT: [[request]] = Convert [[undefined]] declared={type=undefined site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: = Yield [[request]]
// CHECK-LABEL: function {{*}}name="tickLater"
// CHECK: InitialYield
// CHECK-NEXT: [[nothing]] = Undefined
// CHECK-NEXT: [[awaited]] = Await [[nothing]]
// CHECK-NEXT: [[settled]] = Convert [[awaited]] declared={type=undefined site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: = Yield [[settled]]

export function* tick() {
  yield;
}

export async function* tickLater() {
  yield;
}
