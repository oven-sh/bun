// RUN: link
// CHECK: variable [[a]] name="a" module=[[entry]]
// CHECK: module [[entry]] path="{{*}}module-variable-is-listed"
// CHECK: evalscope [[scope]] bindings=[{name="a" variable=[[a]]}]
// CHECK: function [[body]] module=[[entry]] kind=Module
// CHECK: = DirectEval [[text]], [[this]] evalScope=[[scope]]

// RUN(LOCATION): lower
// LOCATION-NOT: = NewObject
// LOCATION-NOT: EnvironmentField

let a = 1;
// The text is more than the name of a binding: a text that is only that is compiled as a read, without a scope record (names-one-binding.js).
eval("(a)");

export {};
