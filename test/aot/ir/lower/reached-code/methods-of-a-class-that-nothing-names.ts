// RUN: link
// CHECK-LABEL: function {{*}}name="Used"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="double"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="Registered"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="create"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return

// RUN(ABSENT): link
// ABSENT-NOT: function {{*}}name="Unused"
// ABSENT-NOT: function {{*}}name="triple"

// A class that nothing refers to, and whose definition does nothing that could be seen, is not in the program. A static field is
// initialized when the class is defined and gets at the class without a reference that could be followed, so a class that has one is whole.
import { Used } from "./imports/two-classes";

console.log(new Used(1).double());
