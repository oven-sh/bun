// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[converted]] = Convert {{*}}declared={type=number} @
// CHECK-NEXT: = Yield [[converted]]

export function* f(x: any): Generator<number> {
  yield x;
}
