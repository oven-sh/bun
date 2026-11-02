// RUN: link
// CHECK-LABEL: function {{*}}name="used"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="replaced"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return

// RUN(ABSENT): link
// ABSENT-NOT: function {{*}}name="unused"
// ABSENT-NOT: variable {{*}}name="unused"

// To make a function does nothing that could be seen, so a constant that holds one and that nothing refers to is not in the program. A
// variable that is stored to holds now one function, now another.
import { used } from "./imports/constants";

console.log(used());
