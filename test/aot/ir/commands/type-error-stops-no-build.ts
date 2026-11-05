// A type error is not reported and stops no build. The written type is tested where the value arrives.
// RUN: link
// CHECK: variable [[count]] name="count" {{*}}declared={type=number|absent}
// CHECK: function {{*}}kind=Module
// CHECK: [[one]] = String string="one"
// CHECK-NEXT: [[converted]] = Convert [[one]] declared={type=number}
// CHECK-NEXT: PutModuleVariable [[converted]] variable=[[count]]
// STATISTIC: ProgramBytes >= 1

export const count: number = "one";
