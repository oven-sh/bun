// RUN: lower
// CHECK-LABEL: function {{*}}name="Counter"{{*}}kind=BaseConstructor{{*}}captures=[{
// CHECK: b0([[step]]: number, [[newTarget]]: anything):
// CHECK: [[object]] = NewObject {{*}}layout=[[layout]]
// CHECK-NEXT: [[this]] = Convert [[object]] declared={type=[[layout]] flags=[IsFromCompiler]}
// CHECK-NEXT: = CallDirect [[step]], [[this]] function=
// CHECK-LABEL: function {{*}}kind=Initializer flags=[HasThis, {{*}}captures=[{
// CHECK: b0([[copy]]: number, [[receiver]]: [[layout]]):

declare function make(): number;

export function create() {
  const step = make();
  return class Counter {
    start = step;
    next = this.start + step;
  };
}
