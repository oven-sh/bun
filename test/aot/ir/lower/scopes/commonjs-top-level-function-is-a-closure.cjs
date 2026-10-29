// RUN: lower
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK: [[closure]] = NewClosure function=
// CHECK-NEXT: [[b]] = Convert [[closure]] declared={type=f{{*}} flags=[IsFromCompiler]}
// CHECK: = NewClosure [[b]] function=
// CHECK: PropSet {{*}}key="a"
// CHECK-LABEL: function {{*}}captures=[{type=f{{*}} flags=[IsFromCompiler]}] thisType
// CHECK-NOT: GetEnvironmentField
// CHECK-NOT: GlobalThis
// CHECK: = Call {{*}}calleeName="b"

// RUN(VARIABLES): lower
// VARIABLES-NOT: ModuleVariable
// VARIABLES: PutModuleVariable {{*}}variable=[[exports]]
// VARIABLES-NOT: PutModuleVariable
// VARIABLES: = GetModuleVariable variable=[[exports]]
// VARIABLES-NOT: ModuleVariable

// RUN(RECORDS): link
// RECORDS-NOT: variable {{*}}name="b"

// The one variable of the module holds its exports object.
function b() {}

exports.a = function () {
  return b();
};
