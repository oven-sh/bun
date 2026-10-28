// RUN: link
// CHECK-LABEL: function {{*}}name="double"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return

// RUN(ABSENT): link
// ABSENT-NOT: name="Unused"
// ABSENT-NOT: name="triple"

// A class that nothing refers to, and whose definition runs nothing that could be noticed, is not defined.
import { Used } from "./imports/two-classes";

console.log(new Used(1).double());
