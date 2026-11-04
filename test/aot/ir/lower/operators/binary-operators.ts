// RUN: lower
// CHECK-LABEL: function {{*}}name="add"
// CHECK-NEXT: ([[a]]: anything, [[b]]: anything):
// CHECK: = Add [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="bitAnd"
// CHECK: [[left]] = Convert [[a]] declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: [[right]] = Convert [[b]] declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: = BitAnd [[left]], [[right]]
// CHECK-LABEL: function {{*}}name="bitOr"
// CHECK: [[left]] = Convert [[a]] declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: [[right]] = Convert [[b]] declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: = BitOr [[left]], [[right]]
// CHECK-LABEL: function {{*}}name="bitXor"
// CHECK: [[left]] = Convert [[a]] declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: [[right]] = Convert [[b]] declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: = BitXor [[left]], [[right]]
// CHECK-LABEL: function {{*}}name="divide"
// CHECK: [[left]] = Convert [[a]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: [[right]] = Convert [[b]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: = Div [[left]], [[right]]
// CHECK-LABEL: function {{*}}name="equal"
// CHECK: = Eq [[a]], [[b]]
// CHECK-NOT: LogicalNot
// CHECK-LABEL: function {{*}}name="exponent"
// CHECK: [[left]] = Convert [[a]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: [[right]] = Convert [[b]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: = Pow [[left]], [[right]]
// CHECK-LABEL: function {{*}}name="greater"
// CHECK: = Greater [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="greaterOrEqual"
// CHECK: = GreaterEq [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="instanceOf"
// CHECK: = InstanceOf [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="leftShift"
// CHECK: [[left]] = Convert [[a]] declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: [[right]] = Convert [[b]] declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: = LShift [[left]], [[right]]
// CHECK-LABEL: function {{*}}name="less"
// CHECK: = Less [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="lessOrEqual"
// CHECK: = LessEq [[a]], [[b]]
// CHECK-LABEL: function {{*}}name="multiply"
// CHECK: [[left]] = Convert [[a]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: [[right]] = Convert [[b]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: = Mul [[left]], [[right]]
// CHECK-LABEL: function {{*}}name="notEqual"
// CHECK: [[loose]] = Eq [[a]], [[b]]
// CHECK-NEXT: = LogicalNot [[loose]]
// CHECK-LABEL: function {{*}}name="remainder"
// CHECK: [[left]] = Convert [[a]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: [[right]] = Convert [[b]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: = Mod [[left]], [[right]]
// CHECK-LABEL: function {{*}}name="rightShift"
// CHECK: [[left]] = Convert [[a]] declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: [[right]] = Convert [[b]] declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: = RShift [[left]], [[right]]
// CHECK-LABEL: function {{*}}name="strictEqual"
// CHECK: = StrictEq [[a]], [[b]]
// CHECK-NOT: LogicalNot
// CHECK-LABEL: function {{*}}name="strictNotEqual"
// CHECK: [[strict]] = StrictEq [[a]], [[b]]
// CHECK-NEXT: = LogicalNot [[strict]]
// CHECK-LABEL: function {{*}}name="subtract"
// CHECK: [[left]] = Convert [[a]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: [[right]] = Convert [[b]] declared={type=number flags=[IsExpected]}
// CHECK-NEXT: = Sub [[left]], [[right]]
// CHECK-LABEL: function {{*}}name="unsignedRightShift"
// CHECK: [[left]] = Convert [[a]] declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: [[right]] = Convert [[b]] declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: = URShift [[left]], [[right]]

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
