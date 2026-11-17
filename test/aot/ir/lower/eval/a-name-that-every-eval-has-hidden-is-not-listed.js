// RUN: link
// CHECK: evalscope [[names]] bindings=[{name="seen" variable={{*}}}, {name="half" variable={{*}}}, {name="first"
// CHECK-NOT: {name="hidden" variable=
// CHECK: function {{*}}kind=Module

// `hidden` is hidden from both evals, so no text can name it: it is not listed and stays what it was. `half` is hidden from one of them and is listed: there the name further in is found first.
let seen = 1,
  half = 2,
  hidden = 3;
function first(hidden, half, text) {
  return eval(text);
}
function second(hidden, text) {
  return eval(text);
}
console.log(first(4, 5, "(hidden + half + seen)"), second(6, "(hidden + half + seen)"), hidden);

export {};
