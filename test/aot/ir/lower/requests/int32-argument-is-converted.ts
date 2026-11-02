// RUN: lower
// CHECK-LABEL: function {{*}}name="f"
// CHECK: [[converted]] = Convert {{*}}declared={type=i32 site=w{{*}} flags=[IsInt32Promise]}
// CHECK-NEXT: = Call {{*}}, [[converted]] calleeName="g"

/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 } from "bun";

function g(n: int32) {}

export function f() {
  g(1);
}
