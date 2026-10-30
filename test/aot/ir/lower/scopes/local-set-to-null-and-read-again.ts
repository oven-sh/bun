// RUN: lower
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
