// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[zero]] = Integer @
// CHECK: [[five]] = Integer integer=5
// CHECK: [[six]] = Integer integer=6
// CHECK: [[text]] = String string="s"
// CHECK: [[head]] = NewObject -, [[zero]], [[five]], [[six]], [[text]] layout={{*}}fields=[0, 1, 2, 3]
// CHECK: ElemDefine [[head]], [[zero]],
// CHECK: ElemDefine [[head]], [[five]],
// CHECK: ElemDefine [[head]], [[six]],
// CHECK: = FinishObject [[head]]

// RUN(NAMES): lower
// NAMES-NOT: PropDefine

// RUN(HEADS): lower
// HEADS-COUNT-1: = NewObject
// HEADS-NOT: = NewObject

// RUN(CLOSES): lower
// CLOSES-COUNT-1: = FinishObject
// CLOSES-NOT: = FinishObject

// RUN(STORES): lower
// STORES-NOT: PropSet
// STORES-NOT: ElemSet

export enum E {
  A,
  B = 5,
  C,
  S = "s",
}
