// RUN: link
// CHECK-LABEL: function {{*}}name="usedHelper"
// CHECK-NOT: OmittedFromExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="helperOfUnmarked"
// CHECK-NOT: OmittedFromExecutable
// CHECK: Return

// A call without the mark runs, whether or not anything reads its result.
import { Used } from "./imports/kinds-without-marks";

console.log(new Used(1).run());
