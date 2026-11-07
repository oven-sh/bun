// RUN: lower
// OPTIONS: type-errors=log
// DIAGNOSTIC: UnprovenInt32
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[asserted]] = Convert {{*}}declared={type=i32 site=w{{*}} flags=[IsInt32Promise]}
// CHECK: = Add [[asserted]],

// RUN(SITES): link
// SITES: typesite {{*}}kind=Assertion text="int32"

/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

export function f(count: number) {
  (count as int32) += 1;
  return count;
}
