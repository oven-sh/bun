// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule
// CHECK: = CreateMappedArguments
// CHECK: [[stored]] = Integer integer=1
// CHECK: PropSet {{*}}, [[stored]] key="a"

// RUN(KIND): lower
// KIND-NOT: isFreeName

arguments = 1;
exports.a = arguments;
