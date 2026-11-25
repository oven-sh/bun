// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[head]] = NewObject layout=[[layout]] @
// CHECK-NEXT: [[namespace]] = FinishObject [[head]]
// CHECK: [[exported]] = Convert [[namespace]] declared={type=undefined|[[layout]] flags=[IsExpected]}
// CHECK: PutModuleVariable [[exported]] variable=
// CHECK: [[name]] = Convert [[namespace]] declared={type=undefined|[[layout]] flags=[IsExpected]}
// CHECK: PropSet [[name]], {{*}}key="a"

// RUN(HIDDEN): lower
// HIDDEN-NOT: key="hidden"

export namespace N {
  export const a = 1;
  const hidden = 2;
}
