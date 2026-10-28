// RUN: lower
// DIAGNOSTIC: UnprovenInt32
// CHECK-LABEL: function {{*}}name="f"
// CHECK: = Convert [[list]] declared={type=i32 site=w{{*}} flags=[IsInt32Promise]} illTypedCause=FromLooseType
// CHECK-NOT: Convert
// CHECK: = CallList {{*}}, [[list]] calleeName="g"

/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

function g(a: number, b: int32, c: int32) {}

export function f(list: [number, number, number]) {
  g(...list);
}
