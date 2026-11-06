// An operator has the position of the first of the operators that `bun run` prints around it. A value that is used once is printed where its variable is named, unless what stands in front of the name may change it.
// RUN: lower
// CHECK-LABEL: function {{*}}name="addsInParentheses"
// CHECK: = Add {{*}} @932
// CHECK-LABEL: function {{*}}name="addsRightOfIn"
// CHECK: = Add {{*}} @1179
// CHECK-LABEL: function {{*}}name="addsThroughTwoNames"
// CHECK: = Mul {{*}} @1064
// CHECK-LABEL: function {{*}}name="multipliesBehindLiteral"
// CHECK: = Mul {{*}} @744
// CHECK-LABEL: function {{*}}name="multipliesBehindName"
// CHECK: = Mul {{*}} @829

export function multipliesBehindLiteral(amount, rate) {
  const fee = amount * rate;
  return 1 + fee;
}

export function multipliesBehindName(base, amount, rate) {
  const fee = amount * rate;
  return base + fee;
}

export function addsInParentheses(amount, rate) {
  const fee = amount + rate;
  return 2 * fee;
}

export function addsThroughTwoNames(amount, rate) {
  const fee = amount * rate;
  const more = 1 + fee;
  return 2 - more;
}

export function addsRightOfIn(amount, rate) {
  const fee = amount + rate;
  return "a" in fee;
}
