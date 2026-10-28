// RUN: link
// CHECK-LABEL: function {{*}}name="used"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="helper"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="unused"
// CHECK-NOT: Return
// CHECK: [[errorOfUnused]] = NewRuntimeError runtimeError=LeftOutOfExecutable
// CHECK-NEXT: Throw [[errorOfUnused]]

// RUN(ABSENT): link
// ABSENT-NOT: name="helperOfUnused"

// An import is followed to the binding that defines it, through the file that passes it on.
import { first } from "./imports/barrel";

console.log(first());
