// RUN: lower
// CHECK-LABEL: function {{*}}name="member"
// CHECK-NOT: IsInt32Promise
// CHECK: results=[{type=anything}]
// CHECK-NOT: Convert
// CHECK: [[read]] = PropGet [[receiver]] key="x"
// CHECK-NEXT: Return [[read]]
// CHECK-LABEL: function {{*}}name="methodResult"
// CHECK-NOT: Convert
// CHECK: [[call]] = Call [[method]], {{*}}calleeName="p.width"
// CHECK-NEXT: [[stated]] = Convert [[call]] declared={type=i32}
// CHECK-NEXT: Return [[stated]]

// Whoever reads an `int32` owes no proof of it: a read of a member is converted to nothing, and the result of a method of the program is said as it is written, without a promise.
/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

export function member(p: { x: int32 }) {
  return p.x;
}

export function methodResult(p: { width(): int32 }) {
  var width = p.width();
  return width;
}
