// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[head]] = NewObject layout=[[layout]] @
// CHECK-NEXT: [[enum]] = FinishObject [[head]]
// CHECK: PutModuleVariable [[enum]] variable=
// CHECK: = Call {{*}}calleeName="f"
// CHECK: PropSet [[enum]], {{*}}key="A"
// CHECK: [[aKey]] = ToPropertyKey
// CHECK: ElemSet [[enum]], [[aKey]],
// CHECK: PropSet [[enum]], {{*}}key="B"
// CHECK: [[bKey]] = ToPropertyKey
// CHECK: ElemSet [[enum]], [[bKey]],
// CHECK: = Call {{*}}calleeName="g"
// CHECK: PropSet [[enum]], {{*}}key="S"
// CHECK-NOT: ToPropertyKey
// CHECK-NOT: ElemSet
// CHECK: Return

// RUN(DEFINITIONS): lower
// DEFINITIONS-NOT: PropDefine
// DEFINITIONS-NOT: ElemDefine

declare function f(): number;
declare function g(): string;

export enum E {
  A = f(),
  B = A + 1,
  S = ("x" + g()) as any,
}
