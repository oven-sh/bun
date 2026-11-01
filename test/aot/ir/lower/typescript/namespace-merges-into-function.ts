// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[read]] = GetModuleVariable variable=[[binding]] @
// CHECK: [[test]] = ToBoolean [[read]]
// CHECK: Branch [[test]] -> taken [[existing]]({{*}}), notTaken [[missing]](
// CHECK: [[existing]]([[function]]
// CHECK-NEXT: Jump -> next [[join]]([[function]]
// CHECK: [[missing]](
// CHECK: [[head]] = NewObject
// CHECK: [[created]] = FinishObject [[head]]
// CHECK: PutModuleVariable [[created]] variable=[[binding]] @
// CHECK: Jump -> next [[join]]([[created]]
// CHECK: [[join]](
// CHECK: [[container]] = GetModuleVariable variable=[[binding]] @
// CHECK: PropSet [[container]], {{*}}key="a"

export function f() {}

export namespace f {
  export const a = 1;
}
