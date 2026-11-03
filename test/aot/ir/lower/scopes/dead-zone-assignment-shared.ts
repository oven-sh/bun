// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: = Call
// CHECK: [[x]] = GetEnvironmentField
// CHECK-NEXT: = CheckInitialized [[x]] name="x"
// CHECK: [[value]] = Call {{*}}calleeName="g"
// CHECK-NOT: CheckInitialized
// CHECK: PutEnvironmentField {{*}}, [[value]] layout=

declare function g(): unknown;

export function f() {
  // @ts-ignore
  x = g();
  let x: unknown;
  const read = () => x;
  x = 1;
  return read;
}
