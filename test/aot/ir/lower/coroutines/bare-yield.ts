// RUN: lower
// CHECK-LABEL: function {{*}}name="tick"
// CHECK: InitialYield
// CHECK-NEXT: [[undefined]] = Undefined
// CHECK-NEXT: = Yield [[undefined]]
// CHECK-LABEL: function {{*}}name="tickLater"
// CHECK: InitialYield
// CHECK-NEXT: [[nothing]] = Undefined
// CHECK-NEXT: [[awaited]] = Await [[nothing]]
// CHECK-NEXT: = Yield [[awaited]]

export function* tick() {
  yield;
}

export async function* tickLater() {
  yield;
}
