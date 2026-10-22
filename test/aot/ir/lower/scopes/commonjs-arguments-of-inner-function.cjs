// RUN: lower
// CHECK: function {{*}}kind=CommonJsModule flags=[IsSloppy] thisType
// CHECK: = CallDirect {{*}}function=[[wrapper]]
// CHECK: function [[wrapper]] module={{*}}flags=[IsSloppy, HasThis] length=5
// CHECK-NEXT: b0([[this]]: anything, [[exports]]: anything, [[require]]: anything, [[module]]: anything, [[filename]]: anything, [[dirname]]: anything):
// CHECK-NOT: Arguments
// CHECK-LABEL: function {{*}}name="own"
// CHECK: = CreateMappedArguments

function own() {
  return arguments.length;
}
exports.own = own;
if (false) arguments;
