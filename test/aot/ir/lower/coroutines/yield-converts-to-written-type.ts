// RUN: lower
// CHECK-LABEL: function {{*}}name="inferred"
// CHECK: InitialYield
// CHECK-NOT: Convert
// CHECK: = Yield
// CHECK-LABEL: function {{*}}name="written"
// CHECK: InitialYield
// CHECK-NEXT: [[converted]] = Convert {{*}}declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: = Yield [[converted]]
// CHECK-LABEL: function {{*}}name="writtenLater"
// CHECK: [[awaited]] = Await
// CHECK-NEXT: [[settled]] = Convert [[awaited]] declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: = Yield [[settled]]

export function* inferred(value: any) {
  yield value;
}

export function* written(value: any): Generator<number> {
  yield value;
}

export async function* writtenLater(value: any): AsyncGenerator<number> {
  yield value;
}
