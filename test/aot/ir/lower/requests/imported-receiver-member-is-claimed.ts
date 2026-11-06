// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: results=[{type=number site=[[result]]}]
// CHECK: [[read]] = PropGet [[receiver]] key="count"
// CHECK-NEXT: [[returned]] = Convert [[read]] declared={type=number site=[[result]]} @
// CHECK-NEXT: Return [[returned]]

// RUN(RECEIVER): lower
// RECEIVER-LABEL: function {{*}}name="f"
// RECEIVER: [[state]] = CheckInitialized {{*}}name="state"
// RECEIVER-NEXT: = PropGet [[state]] key="count"

// The field of a layout holds its type, so the only conversion of what is read is the one to the result of `f`. The variable holds its type too, in whichever module it is read: nothing narrows `state`, so the reference has no conversion.
import { state } from "./imports/state";

export function f() {
  return state.count;
}
