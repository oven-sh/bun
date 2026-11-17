// RUN: lower
// CHECK-LABEL: function {{*}}name="behindAnd"
// CHECK: [[truthy]] = ToBoolean
// CHECK-NEXT: Branch [[truthy]]
// CHECK: EvaluateModule {{*}}[isCallOfRequire]
// CHECK: = Call {{*}}calleeName="chosen"
// CHECK-LABEL: function {{*}}name="proven"
// CHECK-NOT: ToBoolean
// CHECK: EvaluateModule {{*}}[isCallOfRequire]

// FILE: main.mjs
// `flag && made` is `flag` where that is falsy, and `false === undefined` does not hold: the load stands in the place of the call only where the callee is truthy.
import { createRequire } from "node:module";
const chosen = globalThis.flag && createRequire(import.meta.url);
const made = createRequire(import.meta.url);
export function behindAnd() {
  return chosen("./part.cjs");
}
export function proven() {
  return made("./part.cjs");
}

// FILE: part.cjs
module.exports = 1;
