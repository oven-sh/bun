// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[environment]] = NewObject {{*}}layout=[[layout]]
// CHECK: = NewClosure [[environment]], {{*}} function=
// CHECK-LABEL: function {{*}}kind=Arrow
// CHECK: captures=[{type=env [[layout]] flags=[IsFromCompiler]}, {type={{*}}variableName="p"}] thisType
// CHECK: b0([[scope]]: env [[layout]], [[copy]]:
// CHECK: = GetEnvironmentField [[scope]] layout=[[layout]]
// CHECK-NOT: GetEnvironmentField
// CHECK: = NewArray [[copy]],

export function f(p: string) {
  let b = 0;
  const read = () => [p, b];
  b = 1;
  return read;
}
