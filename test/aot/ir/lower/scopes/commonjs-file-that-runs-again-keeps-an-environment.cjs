// RUN: lower
// OPTIONS: entry-points-run-again
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK: [[environment]] = NewObject {{*}}layout=[[layout]]
// CHECK: = NewClosure [[environment]] function=
// CHECK-LABEL: function {{*}}name="inc"
// CHECK: captures=[{type=env [[layout]] flags=[IsFromCompiler]}] thisType
// CHECK: = GetEnvironmentField {{*}}layout=[[layout]]
// CHECK: PutEnvironmentField {{*}}layout=[[layout]]

// RUN(RECORDS): link
// OPTIONS(RECORDS): entry-points-run-again
// RECORDS-NOT: variable {{*}}name="n"

// A variable of the program is there once. What a closure of an earlier run names is what that run declared: each run of the body has an environment of its own.
let n = 0;

module.exports = function inc() {
  n++;
};
