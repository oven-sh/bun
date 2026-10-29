// RUN: lower
// CHECK-LABEL: function {{*}}name="create"
// CHECK: b0([[a]]{{*}}, [[b]]{{*}}, [[c]]{{*}}):
// CHECK: [[head]] = NewObject layout=[[layout]] @
// CHECK: [[zero]] = Integer @
// CHECK: ElemDefine [[head]], [[zero]], [[a]]
// CHECK: [[one]] = Integer integer=1
// CHECK: ElemDefine [[head]], [[one]], [[b]]
// CHECK: PropDefine [[head]], [[c]] key="x"
// CHECK: = FinishObject [[head]]

export function create(a: unknown, b: unknown, c: unknown) {
  return { 0: a, "1": b, x: c };
}
