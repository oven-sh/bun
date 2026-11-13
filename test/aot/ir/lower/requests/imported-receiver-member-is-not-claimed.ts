// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: results=[{type=anything}]
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet [[receiver]] key="count"
// CHECK-NEXT: Return [[read]]

// RUN(RECEIVER): lower
// RECEIVER-LABEL: function {{*}}name="f"
// RECEIVER: [[state]] = CheckInitialized {{*}}name="state"
// RECEIVER-NEXT: = PropGet [[state]] key="count"

// The field of a layout holds its type, so what is read is converted to nothing. The variable holds its type too, in whichever module it is read, so the reference has no conversion.
import { state } from "./imports/state";

export function f() {
  return state.count;
}
