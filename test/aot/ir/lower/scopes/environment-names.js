// A heap snapshot shows what a variable of an environment holds under the name that the source gives it.
// RUN: link
// CHECK: layout [[layout]] kind=Environment {{*}}variableName="held"
// CHECK-LABEL: function {{*}}name="f"
// CHECK: = NewObject {{*}}layout=[[layout]]

export function f(given) {
  let held = given;
  const read = () => held;
  held = [held];
  return read;
}
