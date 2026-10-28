// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[outerHead]] = NewObject
// CHECK: [[outer]] = FinishObject [[outerHead]]
// CHECK: [[innerHead]] = NewObject
// CHECK: [[inner]] = FinishObject [[innerHead]]
// CHECK: PropSet [[outer]], [[inner]] key="B"
// CHECK: PropSet [[inner]], {{*}}key="c"

// RUN(CONTAINERS): lower
// CONTAINERS-COUNT-2: = NewObject
// CONTAINERS-NOT: = NewObject

export namespace A.B {
  export const c = 1;
}
