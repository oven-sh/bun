// RUN: link
// CHECK: module [[entry]] path="{{*}}simple-catch-parameter"
// CHECK: evalscope [[scope]] {{*}}{name="error" kind=SimpleCatchParameter depth=[[depth]] layout=[[layout]] field=[[field]] operand=[[operand]]}
// CHECK: function [[simple]] name="simple" module=[[entry]]
// CHECK: = DirectEval {{*}}evalScope=[[scope]]

// RUN(PATTERN): link
// PATTERN: module [[entry]] path="{{*}}simple-catch-parameter"
// PATTERN: evalscope [[scope]] {{*}}{name="message" depth=[[depth]] layout=[[layout]] field=[[field]] operand=[[operand]]}
// PATTERN: function [[pattern]] name="pattern" module=[[entry]]
// PATTERN: = DirectEval {{*}}evalScope=[[scope]]

// RUN(KIND): link
// KIND-NOT: evalscope [[scope]] {{*}}{name="message" kind=

// The text is more than the name of a binding: a text that is only that is compiled as a read, without a scope record (names-one-binding.js).
export function simple(run) {
  try {
    run();
  } catch (error) {
    return eval("(error)");
  }
}

export function pattern(run) {
  try {
    run();
  } catch ({ message }) {
    return eval("(message)");
  }
}
