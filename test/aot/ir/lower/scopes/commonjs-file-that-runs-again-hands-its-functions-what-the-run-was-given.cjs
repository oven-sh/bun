// RUN: lower
// OPTIONS: entry-points-run-again
// CHECK-LABEL: function {{*}}kind=CommonJsModule
// CHECK: [[exports]] = FinishObject
// CHECK: [[module]] = ModuleBuiltin builtin=ModuleObject
// CHECK: = NewClosure [[module]], [[exports]] function=
// CHECK-LABEL: function {{*}}name="read"
// CHECK-NOT: ModuleBuiltin
// CHECK-NOT: GetModuleVariable
// CHECK: = PropGet {{*}}key="exports"

// `exports` and `module` are given to a run. What a function of an earlier run names is what that run was given: the file's variable and the file's module object are those of the latest run.
exports.n = 1;

exports.read = function read() {
  return exports.n + module.exports.n;
};
