// RUN: lower
// CHECK-LABEL: function {{*}}name="peek"
// CHECK: = DirectEval
// CHECK-NOT: ScopeHasBinding
// CHECK: [[box]] = GetModuleVariable
// CHECK-NEXT: = PropGet [[box]] key="size"

namespace Box {
  export var size = "member";
  export function peek(code: string): string { eval(code); return size; }
}
console.log(Box.peek("0"));
