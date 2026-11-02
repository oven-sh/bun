// RUN: lower
// CHECK-LABEL: function {{*}}name="inferred"
// CHECK: LoopHint
// CHECK-NEXT: = Yield
// CHECK-LABEL: function {{*}}name="written"
// CHECK: LoopHint
// CHECK-NEXT: [[converted]] = Convert {{*}}declared={type=number site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: = Yield [[converted]]

export function* inferred(inner: any) {
  yield* inner;
}

export function* written(inner: any): Generator<number> {
  yield* inner;
}
