// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: parameters=[{type=undefined|null|string site=[[site]] flags=[OmitsNull, OmitsUndefined]}]
// CHECK: b0([[p]]:
// CHECK: [[environment]] = NewObject {{*}}layout=[[layout]]
// CHECK: = NewClosure [[environment]], [[p]] function=
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=env [[layout]] flags=[IsFromCompiler]}, {type=undefined|null|string site=[[site]] flags=[OmitsNull, OmitsUndefined]}] thisType

export function f(p: string) {
  let b = 0;
  const read = () => [p, b];
  b = 1;
  return read;
}
