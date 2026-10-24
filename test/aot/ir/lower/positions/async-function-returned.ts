// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}]
// CHECK: ([[x]]: anything):
// CHECK: [[returned]] = Convert [[x]] declared={type=number|object site=w{{*}}} illTypedCause=FromLooseType
// CHECK-NEXT: Return [[returned]]

export async function f(x: any): Promise<number> {
  return x;
}
