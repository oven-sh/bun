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

// A member that is only read from a namespace object refers to that export alone. The function that is called here never mentions `this`,
// so it cannot find the other members in the object.
import * as functions from "./imports/two-functions";

console.log(functions.used());
