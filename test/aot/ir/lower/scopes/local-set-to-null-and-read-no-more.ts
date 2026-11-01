// RUN: lower
// CHECK-LABEL: function {{*}}name="ofParameter"
// CHECK: ReleaseHint
// CHECK-NOT: ReleaseHint
// CHECK-LABEL: function {{*}}name="toNull"
// CHECK: = Call
// CHECK: ReleaseHint
// CHECK-NOT: ReleaseHint
// CHECK-LABEL: function {{*}}name="toUndefined"
// CHECK: ReleaseHint
// CHECK-NOT: ReleaseHint
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: ReleaseHint
// CHECK: ReleaseHint
// CHECK-NOT: ReleaseHint

declare function make(): object;
declare function use(value: unknown): void;

export function ofParameter(x: object | null) {
  use(x);
  x = null;
  use(1);
}
export function toNull() {
  let x: object | null = make();
  use(x);
  x = null;
  use(1);
}
export function toUndefined() {
  let x: object | undefined = make();
  use(x);
  x = undefined;
  use(1);
}
export function twice() {
  let x: object | null = make();
  let y: object | undefined = make();
  use(x);
  use(y);
  x = null;
  y = undefined;
  use(1);
}
