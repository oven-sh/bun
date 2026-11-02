// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[member]] = Integer integer=1
// CHECK-NEXT: = Convert [[member]] declared={type=i32 flags=[IsInt32Promise]}
// CHECK-NOT: Convert
// CHECK: = Data data=d

/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

export function f() {
  const p: { x: int32; name: string } = { x: 1, name: "a" };
  return p;
}
