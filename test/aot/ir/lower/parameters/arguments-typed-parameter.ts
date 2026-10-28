// RUN: link
// OPTIONS: type-errors=log
// CHECK: typesite [[site]] module=[[entry]] {{*}}kind=Parameter text="number"
// CHECK: module [[entry]] path="{{*}}arguments-typed-parameter"
// CHECK: function [[f]] name="f" module=[[entry]] {{*}}HasArgumentCount, HasHiddenRest, {{*}}parameters=[{type=number site=[[site]]}] results=
// CHECK: b0([[count]]: {{*}}, [[a]]: number, [[rest]]: {{*}}):
// CHECK: = CreateUnmappedArguments [[count]], [[rest]], [[a]]
// CHECK-NOT: Convert [[a]]
// CHECK: = Add {{*}}, [[a]]

export function f(a: number) {
  return arguments.length + a;
}
