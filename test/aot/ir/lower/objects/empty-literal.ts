// RUN: lower
// CHECK-LABEL: function {{*}}name="create"
// CHECK-NOT: = NewObject
// CHECK: = Data data=d
// CHECK-NOT: = NewObject
// CHECK: Return

// RUN(RECORD): link
// RECORD: module [[entry]] path="{{*}}/empty-literal"
// RECORD: function {{*}}name="create" module=[[entry]] position=
// RECORD: = Data data=[[data]] @
// RECORD: data [[data]] root=Object{layout=[[layout]]} module=[[entry]]

export function create() {
  return {};
}
