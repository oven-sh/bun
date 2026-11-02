// JavaScriptCore reports every prefix operator of a row where the first one stands. A value that is used once is printed where its variable is named.
// RUN: lower
// CHECK-LABEL: function {{*}}name="inParentheses"
// CHECK: = ToNumber {{*}} @610
// CHECK-LABEL: function {{*}}name="kept"
// CHECK: = Negate {{*}} @677
// CHECK-LABEL: function {{*}}name="three"
// CHECK: = ToNumber {{*}} @547
// CHECK-LABEL: function {{*}}name="two"
// CHECK: = ToNumber {{*}} @503

export function two(a) {
  return !+a;
}

export function three(a) {
  return typeof !+a;
}

export function inParentheses(a) {
  return 1 + ~(+a);
}

export function kept(a) {
  const negated = -a;
  return !negated;
}
