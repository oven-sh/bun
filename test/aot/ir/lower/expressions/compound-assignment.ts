// RUN: lower
// CHECK-LABEL: function {{*}}name="local"
// CHECK: b0([[x]]: anything, [[y]]: anything):
// CHECK: [[sum]] = Add [[x]], [[y]]
// CHECK-NEXT: [[difference]] = Sub [[sum]], [[y]]
// CHECK-NEXT: [[product]] = Mul [[difference]], [[y]]
// CHECK-NEXT: [[quotient]] = Div [[product]], [[y]]
// CHECK-NEXT: [[remainder]] = Mod [[quotient]], [[y]]
// CHECK-NEXT: [[power]] = Pow [[remainder]], [[y]]
// CHECK-NEXT: [[shiftedLeft]] = LShift [[power]], [[y]]
// CHECK-NEXT: [[shiftedRight]] = RShift [[shiftedLeft]], [[y]]
// CHECK-NEXT: [[unsigned]] = URShift [[shiftedRight]], [[y]]
// CHECK-NEXT: [[masked]] = BitAnd [[unsigned]], [[y]]
// CHECK-NEXT: [[merged]] = BitOr [[masked]], [[y]]
// CHECK-NEXT: [[flipped]] = BitXor [[merged]], [[y]]
// CHECK-NEXT: Return [[flipped]]
// CHECK-LABEL: function {{*}}name="member"
// CHECK: [[object]] = Call {{*}}calleeName="o"
// CHECK-NEXT: [[convertedObject]] = Convert [[object]] declared={type=undefined|null|number|string|symbol|bigint|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[old]] = PropGet [[convertedObject]] key="p"
// CHECK-NOT: calleeName="o"
// CHECK: [[operand]] = Call {{*}}calleeName="v"
// CHECK-NOT: calleeName="o"
// CHECK: [[updated]] = Add [[old]], [[operand]]
// CHECK-NEXT: PropSet [[convertedObject]], [[updated]] key="p"
// CHECK-NOT: calleeName="o"

export function local(x: any, y: any): any {
  x += y;
  x -= y;
  x *= y;
  x /= y;
  x %= y;
  x **= y;
  x <<= y;
  x >>= y;
  x >>>= y;
  x &= y;
  x |= y;
  x ^= y;
  return x;
}

export function member(o: any, v: any) {
  o().p += v();
}
