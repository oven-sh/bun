// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-COUNT-4: = Call
// CHECK: Return

// RUN(REQUESTS): lower
// REQUESTS-LABEL: function {{*}}name="f"
// REQUESTS-NOT: Convert

declare function use(value: unknown): void;

export function f(x: number) {
  use(x as any);
  use(x as unknown);
  use(x satisfies number);
  use(x!);
}
