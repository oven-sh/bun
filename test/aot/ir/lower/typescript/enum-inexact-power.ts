// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[enum]] = FinishObject
// CHECK: [[small]] = Pow
// CHECK: PropSet [[enum]], [[small]] key="Small"
// CHECK: ElemSet [[enum]], [[small]],
// CHECK: [[next]] = Increment [[small]]
// CHECK: PropSet [[enum]], [[next]] key="Next"
// CHECK: ElemSet [[enum]], [[next]],
// CHECK: = PropGet [[enum]] key="Small"
// CHECK: [[twice]] = Mul
// CHECK: PropSet [[enum]], [[twice]] key="Twice"
// CHECK: ElemSet [[enum]], [[twice]],
// CHECK: = Pow
// CHECK: PropSet [[enum]], {{*}}key="Text"
// CHECK-NOT: ElemSet
// CHECK: = PropGet {{*}}key="Text"
// CHECK: PropSet [[enum]], {{*}}key="Copy"
// CHECK-NOT: ElemSet
// CHECK: [[exact]] = Integer integer=1024
// CHECK: PropSet [[enum]], [[exact]] key="Exact"
// CHECK: ElemSet [[enum]], [[exact]],
// CHECK: = PropGet {{*}}key="Small"
// CHECK: = Integer integer=1024
// CHECK: Return

// RUN(CONSTANTS): lower
// CONSTANTS-NOT: = Double
// CONSTANTS-NOT: ToPropertyKey

export enum Size {
  Small = 3 ** 100,
  Next,
  Twice = Small * 2,
  Text = `${3 ** 100}`,
  Copy = Size.Text,
  Exact = 2 ** 10,
}
export const read = Size.Small;
export const exact = Size.Exact;
