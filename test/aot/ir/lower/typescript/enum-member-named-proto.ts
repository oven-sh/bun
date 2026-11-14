// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[head]] = NewObject layout=[[layout]] @
// CHECK-NEXT: [[enum]] = FinishObject [[head]]
// CHECK: [[one]] = Integer integer=1
// CHECK: PropSet [[enum]], [[one]] key="__proto__"
// CHECK: ElemSet [[enum]], [[one]],

// RUN(DEFINITIONS): lower
// DEFINITIONS-NOT: PropDefine
// DEFINITIONS-NOT: ElemDefine

export enum E {
  __proto__ = 1,
}
