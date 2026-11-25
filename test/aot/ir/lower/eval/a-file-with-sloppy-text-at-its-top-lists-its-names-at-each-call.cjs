// RUN: link
// CHECK-NOT: outer=
// CHECK: evalscope {{*}}mode=Sloppy {{*}}{name="old"
// CHECK-NOT: outer=
// CHECK: evalscope {{*}}mode=Sloppy {{*}}{name="old"
// CHECK-NOT: outer=

// Sloppy text at the top of the file declares variables of the file. They and the file's own names lie in one scope, which the call hands over.
var old = 1;
function inside(text) {
  return eval(text);
}
console.log(eval("var fresh = old; fresh"), inside("old"));
