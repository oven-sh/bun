// RUN: lower
// CHECK-LABEL: function {{*}}name="Derived" {{*}}kind=DerivedConstructor
// CHECK: b0([[callee]]: function, [[newTarget]]: anything, [[parameter]]: i32, [[ratio]]: number):
// CHECK: [[parent]] = GetSuperBase
// CHECK-NOT: Convert
// CHECK: [[count]] = Convert [[parameter]] declared={type=i32 site=w{{*}} flags=[IsInt32Promise]} @
// CHECK-NEXT: = SuperConstruct [[parent]], [[newTarget]], [[count]], [[ratio]] layout=

/// <reference path="./imports/bun.d.ts" />

import type { int32 } from "bun";

class Base {
  constructor(count: int32, ratio: number) {}
}

export class Derived extends Base {
  constructor(count: int32, ratio: number) {
    super(count, ratio);
  }
}
