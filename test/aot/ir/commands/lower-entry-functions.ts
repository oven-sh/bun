// RUN: lower
// CHECK-NOT: function {{*}}name="helper"
// CHECK-LABEL: function {{*}}name="add"
// CHECK: = Add
// CHECK: Return
// CHECK-NOT: function {{*}}name="helper"

// RUN(RECORDS): lower
// RECORDS-NOT: module m
// RECORDS-NOT: entry module=

import { helper } from "./imports/helper";

export function add(a: number, b: number): number {
  return helper(a) + b;
}

export const sum = add(1, 2);
