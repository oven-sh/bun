// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: number|object
// CHECK: [[awaited]] = Await
// CHECK-NEXT: [[converted]] = Convert [[awaited]] declared={type=number} @
// CHECK-NEXT: = Yield [[converted]]
// CHECK-NOT: number|object

export async function* f(x: any): AsyncGenerator<number> {
  yield x;
}
