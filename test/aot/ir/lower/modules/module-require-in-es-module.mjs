// RUN: lower
// CHECK-LABEL: function {{*}}name="constantPath"
// CHECK: EvaluateModule module=m
// CHECK-LABEL: function {{*}}name="listOfArguments"
// CHECK: [[meta]] = ModuleBuiltin builtin=ImportMeta
// CHECK: = PropGet [[meta]] key="require"
// CHECK: = CallList {{*}}calleeName="require"

// RUN(NAMES): lower
// NAMES-NOT: kind=CommonJsModule
// NAMES-NOT: key="module"

export function constantPath() {
  return module.require("./imports/common.cjs");
}

export function listOfArguments(names) {
  return module.require(...names);
}
