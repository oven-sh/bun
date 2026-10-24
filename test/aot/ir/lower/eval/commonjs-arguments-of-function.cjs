// RUN: link
// CHECK: evalscope [[scope]] mode=Sloppy
// CHECK: {name="arguments" kind=Arguments
// CHECK-NOT: {name="arguments"
// CHECK: {name="exports" depth=[[depth]] layout=
// CHECK: function {{*}}kind=CommonJsModule flags=[IsSloppy] thisType
// CHECK: = CallDirect {{*}}function=[[wrapper]]
// CHECK: function [[wrapper]] module={{*}}flags=[IsSloppy, HasThis] length=5

// RUN(KIND): lower
// KIND-LABEL: function {{*}}kind=CommonJsModule
// KIND-NOT: Arguments
// KIND-LABEL: function {{*}}name="read"
// KIND: = CreateMappedArguments

function read(text) {
  return eval(text);
}
exports.read = read;
