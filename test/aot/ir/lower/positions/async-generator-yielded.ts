// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK-NOT: number|object
// CHECK: [[awaited]] = Await
// CHECK-NEXT: [[converted]] = Convert [[awaited]] declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: = Yield [[converted]]
// CHECK-NOT: number|object

export async function* f(x: any): AsyncGenerator<number> {
  yield x;
}
