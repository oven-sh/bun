// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-NOT: NewRegExp
// CHECK-LABEL: function {{*}}name="create"
// CHECK: = NewRegExp pattern="a+" regExpFlags=[Global, IgnoreCase]

export function create() {
  return /a+/gi;
}
