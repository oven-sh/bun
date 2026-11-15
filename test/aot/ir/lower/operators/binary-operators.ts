// RUN: lower
// CHECK-LABEL: function {{*}}name="add"
// CHECK-NEXT: ([[a]]: anything, [[b]]: anything):
// CHECK: = Add [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="bitAnd"
// CHECK: = BitAnd [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="bitOr"
// CHECK: = BitOr [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="bitXor"
// CHECK: = BitXor [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="divide"
// CHECK: = Div [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="equal"
// CHECK: = Eq [[a]], [[b]]
// CHECK-NOT: LogicalNot
// CHECK-LABEL: function {{*}}name="exponent"
// CHECK: = Pow [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="greater"
// CHECK: = Greater [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="greaterOrEqual"
// CHECK: = GreaterEq [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="instanceOf"
// CHECK: = InstanceOf [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="leftShift"
// CHECK: = LShift [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="less"
// CHECK: = Less [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="lessOrEqual"
// CHECK: = LessEq [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="multiply"
// CHECK: = Mul [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="notEqual"
// CHECK: [[loose]] = Eq [[a]], [[b]]
// CHECK-NEXT: = LogicalNot [[loose]]
// CHECK-LABEL: function {{*}}name="remainder"
// CHECK: = Mod [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="rightShift"
// CHECK: = RShift [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="strictEqual"
// CHECK: = StrictEq [[a]], [[b]]
// CHECK-NOT: LogicalNot
// CHECK-LABEL: function {{*}}name="strictNotEqual"
// CHECK: [[strict]] = StrictEq [[a]], [[b]]
// CHECK-NEXT: = LogicalNot [[strict]]
// CHECK-LABEL: function {{*}}name="subtract"
// CHECK: = Sub [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="unsignedRightShift"
// CHECK: = URShift [[a]], [[b]]

export function add(a: any, b: any) {
  return a + b;
}

export function bitAnd(a: any, b: any) {
  return a & b;
}

export function bitOr(a: any, b: any) {
  return a | b;
}

export function bitXor(a: any, b: any) {
  return a ^ b;
}

export function divide(a: any, b: any) {
  return a / b;
}

export function equal(a: any, b: any) {
  return a == b;
}

export function exponent(a: any, b: any) {
  return a ** b;
}

export function greater(a: any, b: any) {
  return a > b;
}

export function greaterOrEqual(a: any, b: any) {
  return a >= b;
}

export function instanceOf(a: any, b: any) {
  return a instanceof b;
}

export function leftShift(a: any, b: any) {
  return a << b;
}

export function less(a: any, b: any) {
  return a < b;
}

export function lessOrEqual(a: any, b: any) {
  return a <= b;
}

export function multiply(a: any, b: any) {
  return a * b;
}

export function notEqual(a: any, b: any) {
  return a != b;
}

export function remainder(a: any, b: any) {
  return a % b;
}

export function rightShift(a: any, b: any) {
  return a >> b;
}

export function strictEqual(a: any, b: any) {
  return a === b;
}

export function strictNotEqual(a: any, b: any) {
  return a !== b;
}

export function subtract(a: any, b: any) {
  return a - b;
}

export function unsignedRightShift(a: any, b: any) {
  return a >>> b;
}
