// RUN: lower
// CHECK-LABEL: function {{*}}name="resolver"
// CHECK: [[require]] = ModuleBuiltin builtin=ModuleRequire module=m
// CHECK: [[resolve]] = PropGet [[require]] key="resolve"
// CHECK: = Convert [[resolve]] declared={type=builtin(ModuleRequireResolve) flags=[IsExpected]}
// CHECK: Return

exports.resolver = function resolver() {
  return require.resolve;
};
