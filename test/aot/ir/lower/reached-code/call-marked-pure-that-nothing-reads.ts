// RUN: link
// CHECK-LABEL: function {{*}}name="usedHelper"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return

// RUN(ABSENT): link
// ABSENT-NOT: name="unusedHelper"

// A constant that nothing refers to, with a call marked pure as its initializer, is not evaluated. What only the arguments of the call refer
// to is not in the program, though every kind is made by the one function that calls whichever initializer it was given.
import { Used } from "./imports/kinds";

console.log(new Used(1).run());
