// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[first]] = CheckInitialized [[x]] name="x"
// CHECK: [[second]] = CheckInitialized [[first]] name="x"
// CHECK: = Call {{*}}, -, [[first]], [[second]] calleeName="g"

// RUN(COUNT): lower
// COUNT-COUNT-2: = CheckInitialized
// COUNT-NOT: = CheckInitialized

declare function g(first: unknown, second: unknown): void;

export function f(v: number) {
  switch (v) {
    case 0:
      let x: unknown = 1;
    case 1:
      g(x, x);
  }
}
