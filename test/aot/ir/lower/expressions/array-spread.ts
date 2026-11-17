// RUN: lower
// CHECK-LABEL: function {{*}}name="spread"
// CHECK: b0([[x]]: anything, [[a]]: anything, [[y]]: anything, [[b]]: anything):
// CHECK: [[array]] = NewArray [[x]] contents=anything
// CHECK-NEXT: AppendSpread [[array]], [[a]]
// CHECK-NEXT: AppendElement [[array]], [[y]]
// CHECK-NEXT: AppendHole [[array]]
// CHECK-NEXT: AppendSpread [[array]], [[b]]

// RUN(NOWHERE): lower
// NOWHERE-NOT: IteratorOpen

export function spread(x: any, a: any, y: any, b: any) {
  return [x, ...a, y, , ...b];
}
