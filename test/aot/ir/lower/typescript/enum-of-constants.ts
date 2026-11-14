// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[data]] = Data data=
// CHECK-NEXT: [[enumeration]] = Convert [[data]] declared=
// CHECK-NEXT: PutModuleVariable [[enumeration]]

// RUN(NAMES): lower
// NAMES-NOT: PropDefine

// RUN(HEADS): lower
// HEADS-NOT: = NewObject

// RUN(CLOSES): lower
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
