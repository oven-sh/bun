// RUN: lower
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK: PutModuleVariable {{*}}variable=[[exports]]
// CHECK-NEXT: EvaluateModule module=m{{*}} [isBare, isCallOfRequire]
// CHECK-NEXT: [[required]] = GetModuleVariable variable=
// CHECK-NEXT: PutModuleVariable [[required]] variable=[[exports]]

// RUN(CALLS): lower
// CALLS-NOT: = Call
// CALLS-NOT: RequireModule

// @ts-expect-error
import m = require("./imports/value.cjs");

export = m;
