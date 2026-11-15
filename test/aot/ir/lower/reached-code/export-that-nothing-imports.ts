// RUN: link
// CHECK-LABEL: function {{*}}name="used"
// CHECK-NOT: OmittedFromExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="helper"
// CHECK-NOT: OmittedFromExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="unused"
// CHECK-NOT: Return
// CHECK: [[errorOfUnused]] = NewRuntimeError runtimeError=OmittedFromExecutable name="unused"
// CHECK-NEXT: Throw [[errorOfUnused]]

// RUN(ALSO): link
// ALSO-LABEL: function {{*}}name="helperOfUnused"
// ALSO-NOT: Return
// ALSO: NewRuntimeError runtimeError=OmittedFromExecutable

// A function at the top level that nothing the program runs refers to has no body: it keeps its name and throws. What only it refers to
// has none either.
import { used } from "./imports/two-functions";

console.log(used());
