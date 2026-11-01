// RUN: lower
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK: [[environment]] = NewObject {{*}}layout=[[layout]]
// CHECK: = NewClosure [[environment]] function=
// CHECK-LABEL: function {{*}}name="inc"
// CHECK: captures=[{type=env [[layout]] flags=[IsFromCompiler]}] thisType
// CHECK: = GetEnvironmentField {{*}}layout=[[layout]]
// CHECK: PutEnvironmentField {{*}}layout=[[layout]]

// RUN(VARIABLES): lower
// VARIABLES-NOT: ModuleVariable
// VARIABLES: PutModuleVariable [[inc]] variable=
// VARIABLES-NOT: ModuleVariable

// RUN(RECORDS): link
// RECORDS-NOT: variable {{*}}name="n"

// The one variable of the module holds what it exports.
let n = 0;

module.exports = function inc() {
  n++;
};
