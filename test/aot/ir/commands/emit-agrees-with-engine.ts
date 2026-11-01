// RUN: emit
// CHECK: function [[add]] name="add"
// STATISTIC: ProgramBytes >= 64

import { helper } from "./imports/helper";

export function add(a: number, b: number): number {
  return helper(a) + b;
}

export const sum = add(1, 2);
