// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[absent]] = Absent
// CHECK: [[x]] = CheckInitialized [[absent]] name="x"
// CHECK: = Call {{*}}, -, [[x]] calleeName="g"

declare function g(value: unknown): void;

export function f() {
  // @ts-ignore
  g(x);
  let x: unknown = 1;
}
