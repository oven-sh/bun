// RUN: lower
// CHECK-NOT: ReleaseHint

declare function make(): object;
declare function use(value: unknown): void;

export function captured() {
  let x: object | null = make();
  use(() => x);
  x = null;
}
export function initialized() {
  let x: object | null = null;
  let y = undefined;
  use(1);
}
export function otherValues() {
  let x: unknown = make();
  use(x);
  x = 0;
  use(1);
  x = "";
  use(2);
}
let moduleVariable: object | null = make();
export function ofModule() {
  moduleVariable = null;
}
