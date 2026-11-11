// The file uses the type under a name of its own. The import spells `int32`, so the questions about a written `int32` are asked.
// RUN: lower
// CHECK-LABEL: function {{*}}name="halved"
// CHECK: [[got]] = Call {{*}}calleeName="give"
// CHECK-NEXT: [[stated]] = Convert [[got]] declared={type=i32}
// CHECK: ReturnCall {{*}}{declared={type=i32 flags=[IsInt32Promise]}}]
/// <reference path="../types/imports/bun-declarations.d.ts" />

import type { int32 as whole } from "bun";

function give(): whole {
  return 1;
}

export function halved(): whole {
  return Math.floor(give() / 2);
}
