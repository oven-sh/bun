// RUN: link
// OPTIONS: runs-tests
// CHECK-LABEL: function {{*}}name="ask"
// CHECK: [[callee]] = CheckInitialized {{*}}name="load"
// CHECK: [[kept]] = GetModuleVariable
// CHECK: [[has]] = Builtin builtin=WeakSetPrototypeHas
// CHECK: = Call [[has]], [[kept]], [[callee]]
// CHECK: EvaluateModule {{*}}[isCallOfRequire]
// CHECK: = Call [[callee]], {{*}}calleeName="load"

// FILE: main.mjs
import { load } from "./maker.mjs";
export function ask() {
  return load("./part.cjs");
}

// FILE: maker.mjs
import { createRequire } from "node:module";
export const load = createRequire(import.meta.url);

// FILE: part.cjs
module.exports = 1;
