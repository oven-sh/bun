// RUN: lower
// CHECK-LABEL: function {{*}}name="f"{{*}}flags=[HasRestParameter, HasArgumentCount, HasExplicitName]
// CHECK: b0([[count]]: {{*}}, [[a]]: anything, [[r]]: {{*}}):
// CHECK: = CreateUnmappedArguments [[count]], [[r]], [[a]] @

export function f(a, ...r) {
  return arguments;
}
