// RUN: link
// CHECK: module [[entry]] path="{{*}}function-expression-name"
// CHECK: evalscope [[scope]] {{*}}{name="named" kind=FunctionName depth=[[depth]] operand=0}
// CHECK: function [[named]] name="named" module=[[entry]] {{*}}TakesCallee
// CHECK: b0([[this]]: anything, [[callee]]: function,
// CHECK: = DirectEval [[text]], [[this]], [[newTarget]], [[callee]]{{*}}evalScope=[[scope]]

// RUN(DECLARATION): link
// DECLARATION: evalscope [[scope]] {{*}}{name="declared" depth=[[depth]] variable=[[variable]]}

// RUN(KIND): link
// KIND-NOT: evalscope [[scope]] {{*}}{name="declared" kind=

export const holder = function named() {
  return eval("named");
};

export function declared() {
  return eval("declared");
}
