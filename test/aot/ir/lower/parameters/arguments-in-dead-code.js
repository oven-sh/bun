// RUN: lower
// CHECK-LABEL: function {{*}}name="f"{{*}}flags=[HasExplicitName] length=1 {{*}}parameters=[{type=anything}] results=
// CHECK: b0([[a]]: anything):
// CHECK: Return [[a]]

// RUN(NONE): lower
// NONE-NOT: HasArgumentCount
// NONE-NOT: HasHiddenRest
// NONE-NOT: Arguments

export function f(a) {
  if (false) arguments;
  return a;
}
