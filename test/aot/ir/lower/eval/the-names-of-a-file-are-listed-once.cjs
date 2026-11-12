// RUN: link
// CHECK: evalscope [[names]] bindings=[{name="plain" variable={{*}}}, {name="first" depth=1 variable={{*}}}, {name="second" depth=1 variable={{*}}}, {name="old" depth=1 variable={{*}}}]
// CHECK: evalscope [[inFirst]] mode=Sloppy {{*}}outer=[[names]]
// CHECK: evalscope [[inSecond]] mode=Sloppy {{*}}outer=[[names]]
// CHECK: function {{*}}name="first"
// CHECK: = DirectEval {{*}}evalScope=[[inFirst]]
// CHECK: function {{*}}name="second"
// CHECK: = DirectEval {{*}}evalScope=[[inSecond]]

// What text reaches without an operand of its call is listed once, with the file: each call's record names that list.
var old = 1;
let plain = 2;
function first(text) {
  return eval(text);
}
function second(text) {
  return eval(text);
}
console.log(first("old"), second("plain"));
