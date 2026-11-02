// RUN: link
// CHECK-LABEL: function {{*}}name="unused"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="used"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="helper"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="helperOfUnused"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return

// A namespace object that is used in any way but a read of a member by its name refers to every export.
import * as functions from "./imports/two-functions";

console.log(Object.keys(functions));
