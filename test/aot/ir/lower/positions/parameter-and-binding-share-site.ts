// RUN: link
// OPTIONS: type-errors=log
// CHECK: typesite [[site]] module=[[entry]] {{*}}kind=Parameter text="number"
// CHECK-NOT: typesite {{*}}module=[[entry]] {{*}}kind=Parameter
// CHECK: function {{*}}name="f" module=[[entry]] {{*}}parameters=[{type=number site=[[site]]}]
// CHECK: function [[arrow]] module=[[entry]] {{*}}kind=Arrow {{*}}captures=[{type=number site=[[site]]}]

export function f(x: number) {
  return () => x;
}
