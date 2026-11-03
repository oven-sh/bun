// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[head]] = NewObject layout=[[layout]] @
// CHECK-NEXT: [[namespace]] = FinishObject [[head]]
// CHECK: PutModuleVariable [[namespace]] variable=
// CHECK: PropSet [[namespace]], {{*}}key="a"

// RUN(HIDDEN): lower
// HIDDEN-NOT: key="hidden"

export namespace N {
  export const a = 1;
  const hidden = 2;
}
