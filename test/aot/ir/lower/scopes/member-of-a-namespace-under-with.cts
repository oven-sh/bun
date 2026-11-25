// RUN: lower
// CHECK-LABEL: function {{*}}name="peek"
// CHECK-NOT: ScopeHasBinding {{*}}key="size"
// CHECK: = ScopeHasBinding {{*}}key="Box"
// CHECK: [[named]] = PropGet {{*}}key="Box"
// CHECK-NEXT: Jump -> next [[join]]([[named]])
// CHECK: [[join]]([[box]]):
// CHECK-NEXT: = PropGet [[box]] key="size"
// CHECK-LABEL: function {{*}}name="put"
// CHECK-NOT: ScopeHasBinding {{*}}key="size"
// CHECK: = ScopeHasBinding {{*}}key="Box"
// CHECK-NOT: PropHas
// CHECK: PropSet {{*}}key="size"

namespace Box {
  export let size = "member";
  // @ts-ignore
  export function peek(o: object): string { with (o) { return size; } }
  // @ts-ignore
  export function put(o: object): void { with (o) { size = "stored"; } }
}
console.log(Box.peek({}), Box.put({}));
