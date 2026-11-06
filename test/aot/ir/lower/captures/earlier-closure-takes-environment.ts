// RUN: link
// CHECK: layout [[layout]] kind=Environment {{*}}IsImmutable
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[environment]] = NewObject {{*}}layout=[[layout]]
// CHECK: = NewClosure [[environment]] function=
// CHECK: [[a]] = Call {{*}}calleeName="g"
// CHECK: PutEnvironmentField [[environment]], [[a]] layout=[[layout]]
// CHECK: = NewClosure [[a]] function=
// CHECK-NOT: GetEnvironmentField
// CHECK: = Call {{*}}, -, [[a]] calleeName="use"
// CHECK-LABEL: function {{*}}name="r"
// CHECK: captures=[{type=env [[layout]] flags=[IsFromCompiler]}] thisType
// CHECK-LABEL: function {{*}}name="s"
// CHECK: captures=[{type=anything}] thisType

declare function g(): unknown;
declare function use(value: unknown): void;

export function f() {
  const r = () => a;
  const a = g();
  const s = () => a;
  use(a);
  return [r, s];
}
