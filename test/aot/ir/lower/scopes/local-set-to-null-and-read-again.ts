// RUN: lower
// CHECK-LABEL: function {{*}}name="readBehind"
// CHECK: ReleaseHint
// CHECK-NOT: ReleaseHint
// CHECK-LABEL: function {{*}}name="readBehindJoin"
// CHECK: ReleaseHint
// CHECK-NOT: ReleaseHint
// CHECK-LABEL: function {{*}}name="readInNextTurn"
// CHECK: ReleaseHint
// CHECK-NOT: ReleaseHint

declare function make(): object;
declare function use(value: unknown): void;

export function readBehind() {
  let x: object | null = make();
  use(x);
  x = null;
  use(x);
}
export function readBehindJoin(flag: boolean) {
  let x: object | null = make();
  if (flag) x = null;
  use(x);
}
export function readInNextTurn(count: number) {
  let x: object | null = make();
  for (let i = 0; i < count; i++) {
    use(x);
    x = null;
  }
}
