// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[x]] = Integer integer=1
// CHECK: = Call {{*}}, -, [[x]] calleeName="g"

// RUN(ZONE): lower
// ZONE-LABEL: function {{*}}name="f"
// ZONE-NOT: = Absent
// ZONE-NOT: CheckInitialized

declare function g(value: unknown): void;

export function f() {
  let x: unknown = 1;
  g(x);
}
