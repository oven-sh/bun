// RUN: link
// CHECK-LABEL: function {{*}}name="used"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="helper"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="unused"
// CHECK-NOT: Return
// CHECK: [[errorOfUnused]] = NewRuntimeError runtimeError=LeftOutOfExecutable name="unused"
// CHECK-NEXT: Throw [[errorOfUnused]]

// RUN(ABSENT): link
// ABSENT-NOT: name="helperOfUnused"

// A function at the top level that nothing the program runs refers to has no body: it keeps its name and throws. What only it refers to
// is not in the program.
import { used } from "./imports/two-functions";

console.log(used());
