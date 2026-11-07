// RUN: lower
// CHECK-LABEL: function {{*}}name="outOfChoice"
// CHECK: [[own]] = ModuleBuiltin builtin=ModuleRequire module=
// CHECK-NEXT: = StrictEq {{*}}, [[own]]
// CHECK: EvaluateModule {{*}}[isCallOfRequire]
// CHECK: = Call {{*}}calleeName="either"
// CHECK-LABEL: function {{*}}name="proven"
// CHECK-NOT: ModuleBuiltin
// CHECK: EvaluateModule {{*}}[isCallOfRequire]

// FILE: main.mjs
// What the name holds may be another function. The load stands for a call of the `require` of the file that exports the name, which is told by identity as the file's own is.
import { either, own } from "./tools/loader.mjs";
export function outOfChoice() {
  return either("./part.cjs");
}
export function proven() {
  return own("./part.cjs");
}

// FILE: tools/loader.mjs
export const either = globalThis.given || require;
export const own = require;

// FILE: tools/part.cjs
module.exports = 1;
