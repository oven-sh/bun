// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[converted]] = Convert {{*}}declared={type=i32 site=w{{*}} flags=[IsInt32Promise]}
// CHECK-NEXT: ElemSet {{*}}, [[converted]]

/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

export function f(a: int32[], i: number) {
  a[i] = 1;
}
