// RUN: lower
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK: PutModuleVariable {{*}}variable=[[exports]]
// CHECK-NEXT: EvaluateModule module=m{{*}} [isBare]
// CHECK-NEXT: [[required]] = GetModuleVariable variable=
// CHECK-NEXT: [[m]] = Convert [[required]] declared={type=number}
// CHECK-NEXT: PutModuleVariable [[m]] variable=[[exports]]

// RUN(CALLS): lower
// CALLS-NOT: = Call
// CALLS-NOT: RequireModule

// @ts-expect-error
import m = require("./imports/value.cjs");

export = m;
