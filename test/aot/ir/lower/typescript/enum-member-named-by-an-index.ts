// `bun run` stores Low = 1, [1] = "Low", ["1"] = 7, [7] = "1", in that order, so 7 stays under 1. The reverse key of Low is laid before the member that is named by it.
// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[one]] = Integer integer=1
// CHECK: [[lowName]] = String string="Low"
// CHECK: [[head]] = NewObject
// CHECK: ElemDefine [[head]], [[one]], [[lowName]]
// CHECK: [[seven]] = Integer integer=7
// CHECK: [[name]] = String string="1"
// CHECK: ElemDefine [[head]], {{*}}, [[seven]]
// CHECK: ElemDefine [[head]], [[seven]], [[name]]
// CHECK: = FinishObject [[head]]

export enum Level {
  Low = 1,
  // @ts-ignore
  "1" = 7,
}
