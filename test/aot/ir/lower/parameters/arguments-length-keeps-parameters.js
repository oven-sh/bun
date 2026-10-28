// RUN: lower
// CHECK-LABEL: function {{*}}name="f"{{*}}flags=[HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 {{*}}parameters=[{type=anything}, {type=anything}] results=
// CHECK: b0([[count]]: {{*}}, [[a]]: anything, [[b]]: anything, [[rest]]: {{*}}):
// CHECK: = CreateUnmappedArguments [[count]], [[rest]], [[a]], [[b]]
// CHECK: Return [[a]]
// CHECK: Return [[b]]

// RUN(ONE): lower
// ONE-COUNT-1: = CreateUnmappedArguments
// ONE-NOT: = Create
// ONE-NOT: MappedArgument

// RUN(ENTRY): lower
// ENTRY-NOT: TakesCallee
// ENTRY-NOT: HasRestParameter

export function f(a, b) {
  if (arguments.length === 1) return a;
  return b;
}
