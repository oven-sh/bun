// RUN: lower
// CHECK-LABEL: function {{*}}name="returnedByAnInnerFunction"
// CHECK-NOT: ReturnCall
// CHECK: Call {{*}}calleeName="between"
// CHECK: Return
// CHECK-LABEL: function {{*}}name="statementBetween"
// CHECK-NOT: ReturnCall
// CHECK: Call {{*}}calleeName="between"
// CHECK: Return
// CHECK-LABEL: function {{*}}name="throughAnotherConstant"
// CHECK-NOT: ReturnCall
// CHECK: Call {{*}}calleeName="between"
// CHECK: Return

export function returnedByAnInnerFunction(between) {
  const code = "abcdef".charCodeAt(3);
  const inner = () => code;
  between(inner);
  return 2;
}

export function statementBetween(between) {
  const code = "abcdef".charCodeAt(3);
  between();
  return code;
}

export function throughAnotherConstant(between) {
  const first = "abcdef".charCodeAt(3);
  const second = first;
  between();
  return second;
}
