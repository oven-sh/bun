// RUN: link
// CHECK-LABEL: function {{*}}name="run"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return
// CHECK-LABEL: function {{*}}name="namedOnlyInText"
// CHECK-NOT: LeftOutOfExecutable
// CHECK: Return

// Text that is evaluated in a scope of the file names what it likes.
import { run } from "./imports/with-eval";

console.log(run("namedOnlyInText()"));
