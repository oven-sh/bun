// RUN: lower
// What the block was entered with has a variable of its own, which the store to the name does not reach.
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: PutModuleVariable [[object]] variable=[[parameter]] @
// CHECK: PropSet [[object]], {{*}}key="size"
// CHECK-NOT: variable=[[parameter]] @
// CHECK-LABEL: function {{*}}name="peek"
// CHECK: [[held]] = GetModuleVariable variable=[[parameter]] @
// CHECK: PropGet [[held]] key="size"

namespace Box {
  export var size = "member";
  export function peek() {
    return size;
  }
}
export const peek = Box.peek;
// @ts-ignore
Box = { size: "another object" };
