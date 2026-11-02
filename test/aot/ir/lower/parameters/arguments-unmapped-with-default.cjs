// RUN: lower
// CHECK-LABEL: function {{*}}name="f"{{*}}flags=[IsSloppy, HasArgumentCount, HasHiddenRest, HasExplicitName]
// CHECK: b0([[count]]: int[0, 4294967295], [[a]]: undefined|number, [[rest]]: Array):
// CHECK: = CreateUnmappedArguments [[count]], [[rest]], [[a]]

// RUN(KIND): lower
// KIND-NOT: CreateMappedArguments
// KIND-NOT: MappedArgument

function f(a = 1) {
  return arguments;
}

module.exports = f;
