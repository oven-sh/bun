// RUN: lower
// CHECK-LABEL: function {{*}}name="member"
// CHECK-NOT: IsInt32Promise
// CHECK: results=[{type=i32 site=[[result]]}]
// CHECK: [[read]] = PropGet [[receiver]] key="x"
// CHECK-NEXT: [[claimed]] = Convert [[read]] declared={type=i32 site=[[member]]} illTypedCause=Assertion @
// CHECK-NEXT: Return [[claimed]]
// CHECK-LABEL: function {{*}}name="methodResult"
// CHECK: [[call]] = Call [[method]], {{*}}calleeName="p.width"
// CHECK-NEXT: = Convert [[call]] declared={type=i32 site=w{{*}} flags=[IsInt32Promise]}

/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

export function member(p: { x: int32 }) {
  return p.x;
}

export function methodResult(p: { width(): int32 }) {
  const width = p.width();
  return width;
}
