// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[absent]] = Absent
// CHECK: Switch
// CHECK: [[one]] = Integer integer=1
// CHECK: [[initialized]] = CheckInitialized [[one]] name="x"
// CHECK: = Call {{*}}, -, [[initialized]] calleeName="g"
// CHECK: [[uninitialized]] = CheckInitialized [[absent]] name="x"
// CHECK: = Call {{*}}, -, [[uninitialized]] calleeName="g"

declare function g(value: unknown): void;

export function f(v: number) {
  switch (v) {
    case 0:
      let x: unknown = 1;
      g(x);
      break;
    case 1:
      g(x);
  }
}
