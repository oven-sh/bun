// RUN: link
// CHECK-LABEL: function {{*}}name="used"
// CHECK-NOT: OmittedFromExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="helper"
// CHECK-NOT: OmittedFromExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="unused"
// CHECK-NOT: Return
// CHECK: [[errorOfUnused]] = NewRuntimeError runtimeError=OmittedFromExecutable
// CHECK-NEXT: Throw [[errorOfUnused]]

// RUN(ALSO): link
// ALSO-LABEL: function {{*}}name="helperOfUnused"
// ALSO-NOT: Return
// ALSO: NewRuntimeError runtimeError=OmittedFromExecutable

// An import is followed to the binding that defines it, through the file that passes it on.
import { first } from "./imports/barrel";

console.log(first());
