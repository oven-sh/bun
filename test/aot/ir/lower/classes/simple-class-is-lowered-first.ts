// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: = NewClass
// CHECK-NOT: = NewClass
// CHECK: = String string="first statement"
// CHECK: = NewClass
// CHECK-NOT: = NewClass
// CHECK: = String string="last statement"
// CHECK-NOT: = NewClass

// `bun run` moves a simple top-level class before the other statements of its file, and a compiled program does the same: code above the declaration can use it. A class that extends stays where it is written.
console.log("first statement");
class Moved {
  size = 1;
}
class Stays extends Moved {}
console.log("last statement", Moved, Stays);
