// RUN: lower
// CHECK-LABEL: function {{*}}name="spread"
// CHECK: b0([[x]]: anything, [[a]]: anything, [[y]]: anything, [[b]]: anything):
// CHECK: [[array]] = NewArray [[x]] contents=anything
// CHECK-NEXT: [[convertedA]] = Convert [[a]] declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: AppendSpread [[array]], [[convertedA]]
// CHECK-NEXT: AppendElement [[array]], [[y]]
// CHECK-NEXT: AppendHole [[array]]
// CHECK-NEXT: [[convertedB]] = Convert [[b]] declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: AppendSpread [[array]], [[convertedB]]

// RUN(NOWHERE): lower
// NOWHERE-NOT: IteratorOpen

export function spread(x: any, a: any, y: any, b: any) {
  return [x, ...a, y, , ...b];
}
