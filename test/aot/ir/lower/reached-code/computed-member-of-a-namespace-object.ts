// RUN: link
// CHECK-LABEL: function {{*}}name="unused"
// CHECK-NOT: OmittedFromExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="used"
// CHECK-NOT: OmittedFromExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="helper"
// CHECK-NOT: OmittedFromExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="helperOfUnused"
// CHECK-NOT: OmittedFromExecutable
// CHECK: Return

// A member under a computed name can be any export.
import * as functions from "./imports/two-functions";

export function call(name: "used" | "unused"): number {
  return functions[name]();
}
