// RUN: lower
// DIAGNOSTIC: UnprovenInt32
// CHECK-LABEL: function {{*}}name="f"
// CHECK: = Convert {{*}}flags=[IsInt32Promise]}

/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

export function f(n: number) {
  const v: int32 = n;
  return v;
}
