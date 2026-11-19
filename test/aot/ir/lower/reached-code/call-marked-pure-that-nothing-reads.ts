// RUN: link
// CHECK-LABEL: function {{*}}name="usedHelper"
// CHECK-NOT: OmittedFromExecutable
// CHECK: Return

// RUN(ALSO): link
// ALSO-LABEL: function {{*}}name="unusedHelper"
// ALSO-NOT: Return
// ALSO: NewRuntimeError runtimeError=OmittedFromExecutable

// A constant that nothing refers to, with a call marked pure as its initializer, is not evaluated. What only the arguments of the call refer
// to has no body, though every kind is made by the one function that calls whichever initializer it was given.
import { Used } from "./imports/kinds";

console.log(new Used(1).run());
