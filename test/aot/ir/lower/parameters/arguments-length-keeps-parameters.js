// RUN: lower
// CHECK-LABEL: function {{*}}name="f"{{*}}flags=[HasArgumentCount, HasExplicitName] length=2 {{*}}parameters=[{type=anything}, {type=anything}] results=
// CHECK: b0([[count]]: {{*}}, [[a]]: anything, [[b]]: anything):
// CHECK: = StrictEq [[count]],
// CHECK: Return [[a]]
// CHECK: Return [[b]]

// RUN(ONE): lower
// ONE-NOT: HasHiddenRest
// ONE-NOT: = Create
// ONE-NOT: MappedArgument

// RUN(MAIN): lower
// MAIN-NOT: TakesCallee
// MAIN-NOT: HasRestParameter

export function f(a, b) {
  if (arguments.length === 1) return a;
  return b;
}
