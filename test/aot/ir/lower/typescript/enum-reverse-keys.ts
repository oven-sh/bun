// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[a]] = Integer @
// CHECK: [[aName]] = String string="A"
// CHECK: [[head]] = NewObject
// CHECK: ElemDefine [[head]], [[a]], [[aName]]
// CHECK-NOT: ElemDefine
// CHECK: PropDefine [[head]], {{*}}key="S"
// CHECK-NOT: ElemDefine
// CHECK: PropDefine [[head]], {{*}}key="T"
// CHECK-NOT: ElemDefine
// CHECK: [[n]] = Integer integer=-1
// CHECK: PropDefine [[head]], [[n]] key="N"
// CHECK: [[nName]] = String string="N"
// CHECK: ElemDefine [[head]], [[n]], [[nName]]
// CHECK-NOT: ElemDefine
// CHECK: = FinishObject [[head]]

export enum E {
  A,
  S = "s",
  T = `t`,
  N = -1,
}
